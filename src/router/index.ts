import { createRouter, createWebHistory } from "vue-router";
import { bindAdminRouter, clearAdminToken, isAdminTokenExpired } from "@/composables/useAdmin";

const HomePage = () => import("@/pages/HomePage.vue");
const AuthPage = () => import("@/pages/AuthPage.vue");
const PreGamePage = () => import("@/pages/PreGamePage.vue");
const SingleGamePage = () => import("@/pages/SingleGamePage.vue");
const MultiplayerLobbyPage = () => import("@/pages/MultiplayerLobbyPage.vue");
const MultiplayerRoomPage = () => import("@/pages/MultiplayerRoomPage.vue");
const MultiplayerResultPage = () => import("@/pages/MultiplayerResultPage.vue");
const LeaderboardPage = () => import("@/pages/LeaderboardPage.vue");
const RulesPage = () => import("@/pages/RulesPage.vue");
const DataPage = () => import("@/pages/DataPage.vue");
const AcknowledgementsPage = () => import("@/pages/AcknowledgementsPage.vue");
const AdminLoginPage = () => import("@/pages/AdminLoginPage.vue");
const AdminDiffPage = () => import("@/pages/AdminDiffPage.vue");
const AdminTablePage = () => import("@/pages/AdminTablePage.vue");
const AdminAcknowledgementsPage = () => import("@/pages/AdminAcknowledgementsPage.vue");

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: HomePage },
    { path: "/auth", name: "auth", component: AuthPage },
    { path: "/single", name: "single", component: PreGamePage },
    { path: "/single/play", name: "single-play", component: SingleGamePage },
    { path: "/multi", name: "multi-lobby", component: MultiplayerLobbyPage },
    { path: "/multi/room", name: "multi-room", component: MultiplayerRoomPage },
    { path: "/multi/result", name: "multi-result", component: MultiplayerResultPage },
    { path: "/leaderboard", name: "leaderboard", component: LeaderboardPage },
    { path: "/rules", name: "rules", component: RulesPage },
    { path: "/data", name: "data", component: DataPage },
    { path: "/acknowledgements", name: "acknowledgements", component: AcknowledgementsPage },
    { path: "/admin", name: "admin-login", component: AdminLoginPage },
    { path: "/admin/diff", name: "admin-diff", component: AdminDiffPage, meta: { admin: true } },
    { path: "/admin/table", name: "admin-table", component: AdminTablePage, meta: { admin: true } },
    { path: "/admin/acknowledgements", name: "admin-acknowledgements", component: AdminAcknowledgementsPage, meta: { admin: true } },
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});

router.beforeEach((to, _from, next) => {
  if (to.meta.admin) {
    const token = localStorage.getItem("admin_token");
    if (!token || isAdminTokenExpired(token)) {
      if (token) clearAdminToken();
      next({ name: "admin-login", query: { redirect: to.fullPath } });
      return;
    }
  }
  next();
});

bindAdminRouter(router);

export default router;
