import { useState } from "react";
import { PAGES } from "./lib/pages";
import "./App.css";

function App() {
  const [activeId, setActiveId] = useState(PAGES[0].id);
  const active = PAGES.find((p) => p.id === activeId) ?? PAGES[0];
  const ActivePage = active.Page;

  return (
    <main className="app">
      <aside className="sidebar">
        <h2>FrameVault</h2>

        <nav>
          {PAGES.map(({ id, label }) => (
            <button
              key={id}
              className={id === activeId ? "active" : ""}
              onClick={() => setActiveId(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* 仓库切换按钮稍后放这里 */}
      </aside>

      <section className="content">
        <ActivePage />
      </section>
    </main>
  );
}

export default App;
