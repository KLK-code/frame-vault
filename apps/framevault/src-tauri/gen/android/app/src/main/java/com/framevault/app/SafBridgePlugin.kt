// FrameVault 的 SAF 桥：安卓上的"字节怎么落盘"。
//
// 为什么要有它：安卓上用户选的目录只有一条 `content://` 树 URI + 持久授权，
// 没有路径、没有 `std::fs`。Rust 那边（`src/saf.rs` 的 `SafStore`）只做"领域路径 ↔ 树内相对路径"
// 的换算与参数打包，**路径解析、游标查询、流复制这些脏活都在这里**。
//
// 三层关系，别搞错：
//   领域层（vault/）→ 只认 VaultStore trait；
//   SafStore（Rust, src/saf.rs）→ 实现 trait，把每个原语翻译成一条 Kotlin 命令；
//   这个文件（Kotlin）→ 只跟 ContentResolver / DocumentsContract 打交道。
//
// 命令与入参的名字必须与 `src/saf.rs` 里的结构体一字不差（两端都是 JSON 字段名匹配）。
//
// 这个文件**必须待在 `app/src/main/java/com/framevault/app/`**（被 git 跟踪的那个目录）。
// 隔壁的 `generated/` 整个被 .gitignore 忽略，而且下次代码生成会覆盖它。

package com.framevault.app

import android.app.Activity
import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Base64
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.IOException
import java.security.MessageDigest

// ── 入参（字段名与 Rust 侧一一对应）──

@InvokeArg
class SafPathArgs {
  lateinit var root: String
  lateinit var path: String
}

@InvokeArg
class SafWriteTextArgs {
  lateinit var root: String
  lateinit var path: String
  lateinit var text: String
}

@InvokeArg
class SafWriteBytesArgs {
  lateinit var root: String
  lateinit var path: String
  lateinit var base64: String
}

@InvokeArg
class SafRenameArgs {
  lateinit var root: String
  lateinit var from: String
  lateinit var to: String
}

@InvokeArg
class SafSourceArgs {
  lateinit var root: String
  lateinit var path: String
  lateinit var uri: String
}

@TauriPlugin
class SafBridgePlugin(private val activity: Activity) : Plugin(activity) {
  private val resolver: ContentResolver get() = activity.contentResolver

  /**
   * "一次列目录过程内"的路径 → 文档 id 缓存。
   *
   * 安卓上解析一段路径就是一次跨进程查询，而一次扫描里同一个目录会被反复解析
   * （判存在 → 读 `entry.json` → 读 `note.md`…），一条记录就能多出十几次查询 ——
   * 界面卡顿的主要来源就在这里。
   *
   * **生命周期刻意很短**：每次 `list` 与任何写操作都清空。所以"用户在文件管理器里
   * 改了名字、刷新一下就该看见"这条规矩不受影响（跨刷新的陈旧缓存正是它会破坏的东西）。
   */
  private val docCache = HashMap<String, String>()

  private fun forgetPaths() {
    docCache.clear()
  }

  // ── 选目录（唯一一个要弹系统界面的命令）──

  @Command
  fun pickTree(invoke: Invoke) {
    try {
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
        addFlags(
          Intent.FLAG_GRANT_READ_URI_PERMISSION or
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        )
      }
      startActivityForResult(invoke, intent, "pickTreeResult")
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "打不开系统的目录选择器")
    }
  }

  @ActivityCallback
  fun pickTreeResult(invoke: Invoke, result: ActivityResult) {
    try {
      val uri = result.data?.data
      val out = JSObject()
      if (result.resultCode != Activity.RESULT_OK || uri == null) {
        out.put("cancelled", true)
        invoke.resolve(out)
        return
      }
      // 持久授权：不 take 的话，授权只活到本次进程结束 —— 用户重启 App 后仓库就"打不开"了。
      // 这一步失败通常是因为 Intent 里的 flag 没带全，宁可当场报错也别存一条打不开的引用。
      resolver.takePersistableUriPermission(
        uri,
        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
      )
      out.put("cancelled", false)
      out.put("uri", uri.toString())
      out.put("name", displayName(uri))
      invoke.resolve(out)
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "选目录失败")
    }
  }

  // ── 读 ──

  @Command
  fun readText(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SafPathArgs::class.java)
      val out = JSObject()
      val uri = uriOf(Uri.parse(args.root), args.path)
      if (uri == null) {
        // **明确不存在**：这不是错误（没写过正文的记录就是这样），
        // 交给 Rust 判断；"读失败"才走下面的 reject。两者绝不能混。
        out.put("text", null)
        invoke.resolve(out)
        return
      }
      val text = resolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
        ?: throw IOException("打不开：${args.path}")
      out.put("text", text)
      invoke.resolve(out)
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "读文件失败")
    }
  }

  @Command
  fun list(invoke: Invoke) {
    try {
      // 刷新就是"重新看磁盘"：把上一次扫描攒下的路径缓存丢掉
      forgetPaths()
      val args = invoke.parseArgs(SafPathArgs::class.java)
      val root = Uri.parse(args.root)
      val parentId = docIdOf(root, args.path) ?: throw IOException("目录不存在：${args.path}")
      val items = JSArray()
      queryChildren(root, parentId) { name, mime, size ->
        val item = JSObject()
        item.put("name", name)
        item.put("dir", mime == DocumentsContract.Document.MIME_TYPE_DIR)
        item.put("size", size)
        items.put(item)
      }
      val out = JSObject()
      out.put("items", items)
      invoke.resolve(out)
    } catch (ex: Exception) {
      // 列不出来**必须报错**，不能悄悄返回空列表：Rust 那边的对账靠它区分
      // "目录是空的"和"读不到目录"（后者搞错会清空 media[]，见 AGENTS §9）
      invoke.reject(ex.message ?: "列目录失败")
    }
  }

  @Command
  fun stat(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SafPathArgs::class.java)
      val root = Uri.parse(args.root)
      val out = JSObject()
      val docId = docIdOf(root, args.path)
      if (docId == null) {
        out.put("exists", false)
        out.put("dir", false)
        out.put("name", "")
        invoke.resolve(out)
        return
      }
      var exists = false
      var dir = false
      var name = ""
      resolver.query(
        documentUri(root, docId),
        arrayOf(
          DocumentsContract.Document.COLUMN_DISPLAY_NAME,
          DocumentsContract.Document.COLUMN_MIME_TYPE
        ),
        null, null, null
      )?.use { cursor ->
        if (cursor.moveToFirst()) {
          exists = true
          name = cursor.getString(0) ?: ""
          dir = cursor.getString(1) == DocumentsContract.Document.MIME_TYPE_DIR
        }
      }
      out.put("exists", exists)
      out.put("dir", dir)
      out.put("name", name)
      invoke.resolve(out)
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "查文件失败")
    }
  }

  // ── 写 ──

  @Command
  fun writeText(invoke: Invoke) {
    try {
      forgetPaths()
      val args = invoke.parseArgs(SafWriteTextArgs::class.java)
      writeFile(Uri.parse(args.root), args.path, args.text.toByteArray(Charsets.UTF_8))
      invoke.resolve(JSObject())
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "写文件失败")
    }
  }

  @Command
  fun writeBytes(invoke: Invoke) {
    try {
      forgetPaths()
      val args = invoke.parseArgs(SafWriteBytesArgs::class.java)
      val bytes = Base64.decode(args.base64, Base64.DEFAULT)
      writeFile(Uri.parse(args.root), args.path, bytes)
      invoke.resolve(JSObject())
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "写文件失败")
    }
  }

  @Command
  fun mkdir(invoke: Invoke) {
    try {
      forgetPaths()
      val args = invoke.parseArgs(SafPathArgs::class.java)
      ensureDir(Uri.parse(args.root), args.path)
      invoke.resolve(JSObject())
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "建目录失败")
    }
  }

  @Command
  fun delete(invoke: Invoke) {
    try {
      forgetPaths()
      val args = invoke.parseArgs(SafPathArgs::class.java)
      val root = Uri.parse(args.root)
      val docId = docIdOf(root, args.path)
      if (docId != null) {
        deleteRecursive(root, docId)
      }
      invoke.resolve(JSObject())
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "删目录失败")
    }
  }

  @Command
  fun renameOrMove(invoke: Invoke) {
    try {
      forgetPaths()
      val args = invoke.parseArgs(SafRenameArgs::class.java)
      val root = Uri.parse(args.root)
      val fromParent = parentOf(args.from)
      val toParent = parentOf(args.to)
      val fromName = nameOf(args.from)
      val toName = nameOf(args.to)
      val fromId = docIdOf(root, args.from) ?: throw IOException("不存在：${args.from}")

      if (fromParent == toParent) {
        // 同一层：系统原生改名
        val renamed = DocumentsContract.renameDocument(resolver, documentUri(root, fromId), toName)
          ?: throw IOException("改名失败：$fromName → $toName")
        verifyName(renamed, toName)
      } else {
        // 换了一层：SAF 没有 move。递归复制到新位置，再删旧的。
        // （这是"删除 → 回收站 → 撤销"和"记录换文件夹"的必经之路）
        val destParentId = docIdOf(root, toParent)
          ?: throw IOException("目标目录不存在：$toParent")
        copyRecursive(root, fromId, destParentId, toName)
        deleteRecursive(root, fromId)
      }
      invoke.resolve(JSObject())
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "移动失败")
    }
  }

  // ── 媒体来源（用户从系统选择器选的相册 / 文件）──
  //
  // 这几个命令的"来源"是一条 content:// 文档 URI，不是仓库里的相对路径。
  // Rust 那边照旧只跑导入规则（命名模板 / 撞名去重 / 元数据），
  // **字节怎么进来由这里决定** —— 视频走 copyIn 流式复制，一个字节都不进内存也不经过 JSON 桥。

  @Command
  fun probeSource(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SafSourceArgs::class.java)
      val uri = Uri.parse(args.uri)
      var name = ""
      var size = 0L
      resolver.query(
        uri,
        arrayOf(
          DocumentsContract.Document.COLUMN_DISPLAY_NAME,
          DocumentsContract.Document.COLUMN_SIZE
        ),
        null, null, null
      )?.use { cursor ->
        if (cursor.moveToFirst()) {
          name = cursor.getString(0) ?: ""
          size = if (cursor.isNull(1)) 0L else cursor.getLong(1)
        }
      }
      if (name.isEmpty()) throw IOException("读不出这个文件的名字")
      val out = JSObject()
      out.put("name", name)
      out.put("size", size)
      invoke.resolve(out)
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "读不出这个来源")
    }
  }

  /** 把来源整个读进来（base64）。**只给"图片且不大"用** —— 视频走 copyIn。 */
  @Command
  fun readSource(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SafSourceArgs::class.java)
      val uri = Uri.parse(args.uri)
      val bytes = resolver.openInputStream(uri)?.use { it.readBytes() }
        ?: throw IOException("打不开这个来源")
      val out = JSObject()
      out.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
      invoke.resolve(out)
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "读不出这个来源")
    }
  }

  /**
   * 把来源**流式**复制进仓库，一遍过把 sha256 也算掉。
   * 视频几百兆也不会有内存问题：这里只有 64KB 的缓冲。
   */
  @Command
  fun copyIn(invoke: Invoke) {
    try {
      forgetPaths()
      val args = invoke.parseArgs(SafSourceArgs::class.java)
      val root = Uri.parse(args.root)
      val source = Uri.parse(args.uri)

      val parentId = ensureDir(root, parentOf(args.path))
      val name = nameOf(args.path)
      if (name.isEmpty()) throw IOException("路径里没有文件名：${args.path}")

      // 领域层已经按"撞名去重"给过唯一名字了，这里撞上就删掉旧的（不该发生，但别让它变成两份）
      childDocId(root, parentId, name)?.let { deleteRecursive(root, it) }

      val created = DocumentsContract.createDocument(
        resolver, documentUri(root, parentId), mimeOf(name), name
      ) ?: throw IOException("建不出文件：$name")
      verifyName(created, name)

      val digest = MessageDigest.getInstance("SHA-256")
      var size = 0L
      resolver.openInputStream(source)?.use { input ->
        resolver.openOutputStream(created, "wt")?.use { output ->
          val buf = ByteArray(64 * 1024)
          while (true) {
            val read = input.read(buf)
            if (read <= 0) break
            digest.update(buf, 0, read)
            output.write(buf, 0, read)
            size += read
          }
        } ?: throw IOException("写不进去：$name")
      } ?: throw IOException("打不开这个来源")

      val out = JSObject()
      out.put("size", size)
      out.put("sha256", digest.digest().joinToString("") { "%02x".format(it) })
      invoke.resolve(out)
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "复制失败")
    }
  }

  // ── 内部实现 ──

  /**
   * 写一个文件。
   *
   * SAF 没有"同目录 rename 覆盖"这种原子语义（桌面上 `NativeFs` 靠 tmp + rename 保证
   * 不会留下半个文件）。这里尽力逼近：写 `名字.tmp` → 删掉旧的 → 把 tmp 改名成正式名字。
   * 中间那一瞬间正式文件是不存在的 —— 这个差异写在 AGENTS §9 里，不假装它不存在。
   */
  private fun writeFile(root: Uri, path: String, bytes: ByteArray) {
    val parent = parentOf(path)
    val name = nameOf(path)
    if (name.isEmpty()) throw IOException("路径里没有文件名：$path")
    val parentId = ensureDir(root, parent)
    val existingId = childDocId(root, parentId, name)

    if (existingId == null) {
      val created = DocumentsContract.createDocument(
        resolver, documentUri(root, parentId), mimeOf(name), name
      ) ?: throw IOException("建不出文件：$name")
      verifyName(created, name)
      resolver.openOutputStream(created, "wt")?.use { it.write(bytes) }
        ?: throw IOException("写不进去：$name")
      return
    }

    val tmpName = "$name.tmp"
    val tmpId = childDocId(root, parentId, tmpName)
    val tmpUri = if (tmpId == null) {
      DocumentsContract.createDocument(
        resolver, documentUri(root, parentId), mimeOf(name), tmpName
      ) ?: throw IOException("建不出临时文件：$tmpName")
    } else {
      documentUri(root, tmpId)
    }
    resolver.openOutputStream(tmpUri, "wt")?.use { it.write(bytes) }
      ?: throw IOException("写不进临时文件：$tmpName")
    deleteRecursive(root, existingId)
    DocumentsContract.renameDocument(resolver, tmpUri, name)
      ?: throw IOException("收尾失败：$tmpName → $name")
  }

  private fun ensureDir(root: Uri, path: String): String {
    var current = DocumentsContract.getTreeDocumentId(root)
    for (segment in path.split("/")) {
      if (segment.isEmpty()) continue
      current = childDocId(root, current, segment) ?: run {
        val created = DocumentsContract.createDocument(
          resolver,
          documentUri(root, current),
          DocumentsContract.Document.MIME_TYPE_DIR,
          segment
        ) ?: throw IOException("建不出目录：$segment")
        verifyName(created, segment)
        DocumentsContract.getDocumentId(created)
      }
    }
    return current
  }

  private fun deleteRecursive(root: Uri, docId: String) {
    // 先删孩子再删自己：相当一部分 provider 拒绝删非空目录
    val children = mutableListOf<String>()
    collectChildIds(root, docId, children)
    for (childId in children) {
      deleteRecursive(root, childId)
    }
    DocumentsContract.deleteDocument(resolver, documentUri(root, docId))
  }

  private fun collectChildIds(root: Uri, parentId: String, out: MutableList<String>) {
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(root, parentId)
    resolver.query(
      childrenUri,
      arrayOf(
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_MIME_TYPE
      ),
      null, null, null
    )?.use { cursor ->
      while (cursor.moveToNext()) {
        val id = cursor.getString(0)
        out.add(id)
      }
    }
  }

  private fun copyRecursive(root: Uri, srcId: String, destParentId: String, name: String) {
    val src = documentUri(root, srcId)
    var isDir = false
    var mime = "application/octet-stream"
    resolver.query(
      src,
      arrayOf(
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME
      ),
      null, null, null
    )?.use { cursor ->
      if (cursor.moveToFirst()) {
        mime = cursor.getString(0) ?: mime
        isDir = mime == DocumentsContract.Document.MIME_TYPE_DIR
      }
    }

    val created = DocumentsContract.createDocument(
      resolver, documentUri(root, destParentId), mime, name
    ) ?: throw IOException("复制不过去：$name")
    verifyName(created, name)

    if (isDir) {
      val children = mutableListOf<String>()
      collectChildIds(root, srcId, children)
      for (childId in children) {
        val childName = nameOfUri(documentUri(root, childId))
          ?: throw IOException("读不出子项名字（$name）")
        copyRecursive(root, childId, DocumentsContract.getDocumentId(created), childName)
      }
    } else {
      resolver.openInputStream(src)?.use { input ->
        resolver.openOutputStream(created, "wt")?.use { output -> input.copyTo(output) }
      } ?: throw IOException("复制不了：$name")
    }
  }

  private fun queryChildren(
    root: Uri,
    parentId: String,
    onItem: (name: String, mime: String, size: Long) -> Unit
  ) {
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(root, parentId)
    resolver.query(
      childrenUri,
      arrayOf(
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE
      ),
      null, null, null
    )?.use { cursor ->
      while (cursor.moveToNext()) {
        val name = cursor.getString(0) ?: continue
        val mime = cursor.getString(1) ?: ""
        val size = if (cursor.isNull(2)) 0L else cursor.getLong(2)
        onItem(name, mime, size)
      }
    }
  }

  /** 树里的相对路径 → 文档 id（一段一段按名字走下去；同一次扫描内走缓存） */
  private fun docIdOf(root: Uri, path: String): String? {
    val key = "$root|$path"
    docCache[key]?.let { return it }

    var current = DocumentsContract.getTreeDocumentId(root)
    var walked = ""
    for (segment in path.split("/")) {
      if (segment.isEmpty()) continue
      walked = if (walked.isEmpty()) segment else "$walked/$segment"
      current = childDocId(root, current, segment) ?: return null
      // 走过的每一段都记下来：一次扫描里后面的调用直接就命中
      docCache["$root|$walked"] = current
    }
    docCache[key] = current
    return current
  }

  private fun childDocId(root: Uri, parentId: String, name: String): String? {
    var found: String? = null
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(root, parentId)
    resolver.query(
      childrenUri,
      arrayOf(
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME
      ),
      null, null, null
    )?.use { cursor ->
      while (cursor.moveToNext()) {
        if (cursor.getString(1) == name) {
          found = cursor.getString(0)
          break
        }
      }
    }
    return found
  }

  private fun uriOf(root: Uri, path: String): Uri? {
    val docId = docIdOf(root, path) ?: return null
    return documentUri(root, docId)
  }

  private fun documentUri(root: Uri, docId: String): Uri =
    DocumentsContract.buildDocumentUriUsingTree(root, docId)

  private fun displayName(root: Uri): String {
    var name = ""
    val docId = DocumentsContract.getTreeDocumentId(root)
    resolver.query(
      documentUri(root, docId),
      arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
      null, null, null
    )?.use { cursor ->
      if (cursor.moveToFirst()) name = cursor.getString(0) ?: ""
    }
    return name
  }

  private fun nameOfUri(docUri: Uri): String? {
    var name: String? = null
    resolver.query(
      docUri,
      arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
      null, null, null
    )?.use { cursor ->
      if (cursor.moveToFirst()) name = cursor.getString(0)
    }
    return name
  }

  /**
   * provider 有可能"自作主张"改名（撞名时加后缀）。领域层是拿"撞名判定 + 指定名字"
   * 调过来的，名字被系统改掉就等于磁盘布局跟领域层想的不一样 —— 当场报错，别默默接受。
   */
  private fun verifyName(created: Uri, expected: String) {
    val actual = nameOfUri(created)
    if (actual != null && actual != expected) {
      throw IOException("系统把名字改成了 $actual（想要 $expected）")
    }
  }

  private fun parentOf(path: String): String =
    if (path.contains('/')) path.substringBeforeLast('/') else ""

  private fun nameOf(path: String): String = path.substringAfterLast('/')

  private fun mimeOf(name: String): String =
    when (name.substringAfterLast('.', "").lowercase()) {
      "json" -> "application/json"
      "md" -> "text/markdown"
      "txt" -> "text/plain"
      "jpg", "jpeg" -> "image/jpeg"
      "png" -> "image/png"
      "gif" -> "image/gif"
      "webp" -> "image/webp"
      "bmp" -> "image/bmp"
      "tif", "tiff" -> "image/tiff"
      "mp4" -> "video/mp4"
      "mov" -> "video/quicktime"
      "webm" -> "video/webm"
      else -> "application/octet-stream"
    }
}
