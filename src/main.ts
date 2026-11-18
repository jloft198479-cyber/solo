import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./assets/styles/main.css";
import { initPerfDiagnostics } from "./services/perf-diagnostics";

// 性能诊断（默认惰性：未设 localStorage['solo-perf']='1' 时零开销）
initPerfDiagnostics();

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.mount("#app");
