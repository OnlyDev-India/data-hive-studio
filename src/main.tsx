import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// NOTE: <StrictMode> is intentionally NOT used. It double-invokes effects in
// development, which fired every database query twice (describes, SELECTs,
// COUNTs) and polluted the activity feed with phantom duplicates.
createRoot(document.getElementById("root")!).render(<App />);
