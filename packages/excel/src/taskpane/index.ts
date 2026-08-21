import { mount } from "svelte";
import App from "./components/app.svelte";
import "@office-agents/core/index.css";
import "./index.css";
import { pinTaskpane } from "./pin-taskpane";

Office.onReady(() => {
  void pinTaskpane();

  const target = document.getElementById("container");
  if (!target) return;

  mount(App, { target });
});
