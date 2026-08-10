<script setup lang="ts">
import { onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAdmin } from "@/composables/useAdmin";

const router = useRouter();
const route = useRoute();
const { loginForm, authLoading, authError, doLogin, isAdmin } = useAdmin();

onMounted(() => {
  if (isAdmin.value) {
    router.replace((route.query.redirect as string) || "/admin/diff");
  }
});

async function handleSubmit() {
  const ok = await doLogin();
  if (ok) router.replace((route.query.redirect as string) || "/admin/diff");
}
</script>

<template>
  <div class="ad-page ad-login-page">
    <header class="ad-top">
      <button class="back-btn" @click="router.push('/')"><Icon icon="ph:arrow-left-duotone" /> 返回</button>
      <div class="ad-top-right" />
    </header>

    <section class="ad-login-card">
      <div class="ad-login-glyph"><Icon icon="ph:lock-key-duotone" /></div>
      <p class="ad-login-kicker">Phrolova · Admin</p>
      <h1 class="ad-login-title">管理面板</h1>
      <p class="ad-login-sub">仅限授权管理员访问，会话 2 小时有效</p>

      <form class="ad-login-form" @submit.prevent="handleSubmit">
        <label class="form-field">
          <span class="form-label">用户名</span>
          <input v-model="loginForm.username" class="form-input" type="text" placeholder="管理员账号" autocomplete="username" />
        </label>
        <label class="form-field">
          <span class="form-label">密码</span>
          <input v-model="loginForm.password" class="form-input" type="password" placeholder="管理员密码" autocomplete="current-password" />
        </label>

        <div v-if="authError" class="ad-error">{{ authError }}</div>

        <button class="btn ad-login-btn" type="submit" :disabled="authLoading">
          <Icon v-if="authLoading" icon="ph:spinner-gap-bold" class="ph-spin" />
          {{ authLoading ? "登录中..." : "进入管理面板" }}
        </button>
      </form>
    </section>
  </div>
</template>
