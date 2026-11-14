import { CameraView } from "./components/CameraView";

export function App() {
  return (
    <main className="app">
      <header className="top">
        <h1>JimBro</h1>
      </header>
      <CameraView />
      <p className="muted small">
        Video stays on your phone. Camera analysis is not a clinical assessment.
      </p>
    </main>
  );
}
