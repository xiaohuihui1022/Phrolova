import { Icon } from "@iconify/vue";
import { createPinia } from "pinia";
import { createApp } from "vue";

import App from "./App.vue";
import router from "./router";
import { i18n } from "./i18n";
import "./assets/app.css";

const app = createApp(App);
const pinia = createPinia();

app.component("Icon", Icon);
app.use(pinia);
app.use(i18n);
app.use(router);

app.mount("#app");
