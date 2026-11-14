import { LiveWorkout } from "./components/LiveWorkout";

export function App() {
  return (
    <main className="app">
      <header className="top">
        <h1>JimBro</h1>
      </header>
      <LiveWorkout />
      <p className="muted small">
        Video stays on your phone; only joint angles go to the Pi. TUT is estimated
        movement-phase timing, not measured muscle tension. Not a clinical assessment.
      </p>
    </main>
  );
}
