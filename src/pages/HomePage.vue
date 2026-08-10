<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, shallowRef, ref, watch } from "vue";
import { useRoute } from "vue-router";
import gsap from "gsap";

import ModalOverlay from "@/components/shared/ModalOverlay.vue";
import { useAuthStore } from "@/stores/auth";
import { useMultiGameStore } from "@/stores/multiGame";
import type { CaptchaResponse } from "@/types";
import { errMsg } from "@/api/client";
import { fetchCaptcha, fetchOnlineStats, fetchScryptParams } from "@/api";
import { computeScryptHex } from "@/lib/scrypt-client";
import { getCookieConsent, setCookieConsent } from "@/composables/useStorage";

const route = useRoute();
const authStore = useAuthStore();
const multiGameStore = useMultiGameStore();

const PORTRAIT_POOL = [
  { src: "/media/frolova.png", alt: "弗洛洛" },
  { src: "/media/jinhsi.png", alt: "今汐" },
  { src: "/media/phoebe.png", alt: "菲比" },
];

function randomPortrait() {
  return PORTRAIT_POOL[Math.floor(Math.random() * PORTRAIT_POOL.length)];
}

const currentPortrait = ref(randomPortrait());
const frolovaKey = ref(0);
const frolovaRef = shallowRef<HTMLElement | null>(null);
const menuRef = shallowRef<HTMLElement | null>(null);
let frolovaX: gsap.QuickToFunc | null = null;

let frolovaRX: gsap.QuickToFunc | null = null;
let frolovaRY: gsap.QuickToFunc | null = null;
let ctx: gsap.Context | null = null;

function onMouseMove(e: MouseEvent) {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const tx = ((e.clientX - cx) / cx) * 30;
  const ty = ((e.clientY - cy) / cy) * 20;
  frolovaX?.(tx);

  frolovaRX?.(tx * 0.3);
  frolovaRY?.(-ty * 0.3);
}

function setupGsap() {
  ctx = gsap.context(() => {
    const portrait = frolovaRef.value;
    if (portrait) {
      frolovaX = gsap.quickTo(portrait, "x", { duration: 0.6, ease: "power2.out" });

      frolovaRX = gsap.quickTo(portrait, "rotateY", { duration: 0.6, ease: "power2.out" });
      frolovaRY = gsap.quickTo(portrait, "rotateX", { duration: 0.6, ease: "power2.out" });


    }

    const items = menuRef.value?.querySelectorAll(".menu-li");
    if (items) {
      gsap.from(items, {
        opacity: 0,
        x: 60,
        duration: 0.7,
        ease: "power2.out",
        stagger: 0.15,
        delay: 0.15,
        clearProps: "all",
      });
    }
  });
}

async function resetFrolova() {
  currentPortrait.value = randomPortrait();
  frolovaKey.value = 0;
  await nextTick();
  frolovaKey.value = Date.now();
  await nextTick();
  ctx?.revert();
  setupGsap();
}

watch(() => route.name, (name) => {
  if (name === "home") resetFrolova();
}, { immediate: true });

onMounted(() => {
  setupGsap();
});

onBeforeUnmount(() => {
  ctx?.revert();
  stopOnlinePoll();
});

const ANNOUNCE_KEY = "phrolova_announcement_v1";
const showAnnouncement = shallowRef(false);
const showCookieConsent = shallowRef(false);
const showAuthModal = shallowRef(false);

// ── 全站在线人数 ──
const onlineCount = ref(0);
const onlineLoading = shallowRef(true);
let onlinePollTimer: number | null = null;
const ONLINE_POLL_INTERVAL = 30 * 1000; // 30 秒轮询

async function loadOnlineCount() {
  try {
    const data = await fetchOnlineStats();
    onlineCount.value = Math.max(0, Number(data.online_count) || 0);
  } catch {
    // 静默失败，不影响首页体验
  } finally {
    onlineLoading.value = false;
  }
}

function startOnlinePoll() {
  stopOnlinePoll();
  loadOnlineCount();
  onlinePollTimer = window.setInterval(() => {
    loadOnlineCount();
  }, ONLINE_POLL_INTERVAL);
}

function stopOnlinePoll() {
  if (onlinePollTimer !== null) {
    clearInterval(onlinePollTimer);
    onlinePollTimer = null;
  }
}
const authMode = shallowRef<"login" | "register">("login");
const resetMode = shallowRef(false);
const captchaImage = shallowRef("");
const captchaId = shallowRef("");
const localError = shallowRef("");
const form = reactive({
  username: "",
  password: "",
  captchaText: "",
});
const resetForm = reactive({
  oldPassword: "",
  newPassword: "",
  confirmPassword: "",
  captchaText: "",
});
const upgrading = shallowRef(false);

const menuItems = [
  { cn: "单人游戏", en: "Single Player", to: "/single", icon: "ph:user-duotone" },
  { cn: "多人对战", en: "Multiplayer", to: "/multi", icon: "ph:users-three-duotone" },
  { cn: "数据图鉴", en: "Database", to: "/data", icon: "ph:database-duotone" },
  { cn: "机制规则", en: "Game Rules", to: "/rules", icon: "ph:book-open-text-duotone" },
  { cn: "共鸣榜", en: "Leaderboard", to: "/leaderboard", icon: "ph:trophy-duotone" },
  { cn: "致谢名单", en: "Acknowledgements", to: "/acknowledgements", icon: "ph:hand-heart-duotone" },
] as const;

async function loadCaptcha() {
  const data = await fetchCaptcha();
  captchaImage.value = data.image || "";
  captchaId.value = data.captcha_id || "";
}

async function submitAuth() {
  localError.value = "";
  try {
    const payload = {
      username: form.username.trim(),
      password: form.password,
      captchaId: captchaId.value,
      captchaText: form.captchaText.trim(),
    };
    if (authMode.value === "login") {
      await authStore.login(payload);
    } else {
      await authStore.register(payload);
    }
    closeAuthModal();
  } catch (reason) {
    const errCode = String((reason as any)?.error_code ?? (reason as any)?.response?.data?.error_code ?? "");
    const httpStatus = (reason as any)?.response?.status ?? 0;
    if ((httpStatus === 426 || httpStatus === 400) && errCode === 'SCRYPT_UNAVAILABLE') {
      resetMode.value = true;
      resetForm.oldPassword = "";
      resetForm.newPassword = "";
      resetForm.confirmPassword = "";
      resetForm.captchaText = "";
      localError.value = "检测到旧版密码格式，请输入旧密码并设置新密码以升级";
      loadCaptcha().catch(() => { /* ignore */ });
      return;
    }
    localError.value = errMsg(reason) || "账号操作失败";
    await loadCaptcha();
    form.captchaText = "";
  }
}

async function submitResetPassword() {
  localError.value = "";
  if (!resetForm.oldPassword) {
    localError.value = "请输入旧密码以验证身份";
    return;
  }
  if (resetForm.newPassword.length < 6) {
    localError.value = "新密码至少 6 位";
    return;
  }
  if (resetForm.newPassword !== resetForm.confirmPassword) {
    localError.value = "两次输入的密码不一致";
    return;
  }

  upgrading.value = true;
  try {
    // 1. 获取 scrypt 参数（salt + N/r/p/dklen，不含哈希!）
    const params = await fetchScryptParams(form.username.trim());

    // 2. 浏览器端计算 scrypt(旧密码, salt, params) → derived_hex
    const oldPasswordHash = await computeScryptHex(resetForm.oldPassword, params);

    // 3. 发送 derived_hex 给服务端验证，验证通过则升级为 PBKDF2
    await authStore.upgradePassword({
      username: form.username.trim(),
      oldPasswordHash,
      newPassword: resetForm.newPassword,
      captchaId: captchaId.value,
      captchaText: resetForm.captchaText.trim(),
    });
    closeAuthModal();
  } catch (reason) {
    localError.value = errMsg(reason) || "密码升级失败";
    await loadCaptcha();
    resetForm.captchaText = "";
  } finally {
    upgrading.value = false;
  }
}

function openAuthModal(mode: "login" | "register" = "login") {
  authMode.value = mode;
  resetMode.value = false;
  showAuthModal.value = true;
  localError.value = "";
  form.username = "";
  form.password = "";
  form.captchaText = "";
  resetForm.oldPassword = "";
  resetForm.newPassword = "";
  resetForm.confirmPassword = "";
  resetForm.captchaText = "";
  loadCaptcha().catch(() => {
    localError.value = "验证码加载失败";
  });
}

function closeAuthModal() {
  showAuthModal.value = false;
  resetMode.value = false;
}

function handleLogout() {
  multiGameStore.disconnect();
  authStore.logout();
}

onMounted(async () => {
  // 启动在线人数轮询
  startOnlinePoll();

  // 首次访问公告弹窗
  try {
    if (!localStorage.getItem(ANNOUNCE_KEY)) {
      showAnnouncement.value = true;
    }
  } catch { /* ignore */ }

  // 首次访问 Cookie 同意提示（仅未做选择时展示）
  try {
    if (getCookieConsent() === null) {
      showCookieConsent.value = true;
    }
  } catch { /* ignore */ }

  // hydrate() 已由 App.vue 初始化时调用，此处不再重复
  if (authStore.isAuthenticated) {
    await multiGameStore.resumeRoom().catch(() => undefined);
  }
});

function closeAnnouncement() {
  showAnnouncement.value = false;
  try { localStorage.setItem(ANNOUNCE_KEY, "1"); } catch { /* ignore */ }
}

function acceptCookies() {
  showCookieConsent.value = false;
  setCookieConsent("accepted");
}

function declineCookies() {
  showCookieConsent.value = false;
  setCookieConsent("declined");
}
</script>

<template>
  <section class="page-shell" @mousemove="onMouseMove">
    <div id="start-menu" class="home-stage">
      <div class="home-title-block">
        <h1 class="home-title">弗一把</h1>
        <p class="home-subtitle">Phrolova</p>
        <div class="home-online-badge" :title="`${onlineCount} 位玩家在线`">
          <span class="home-online-dot" :class="{ 'home-online-dot--active': !onlineLoading && onlineCount > 0 }"></span>
          <span class="home-online-text">
            <template v-if="onlineLoading">加载中...</template>
            <template v-else>{{ onlineCount }} 位玩家在线</template>
          </span>
        </div>
      </div>
      <div class="home-portrait" :key="frolovaKey" ref="frolovaRef">
        <div class="home-portrait-inner">
          <img :src="currentPortrait.src" :alt="currentPortrait.alt" />
        </div>
      </div>

      <div class="menu-container">
        <ul ref="menuRef" class="menu-list" aria-label="主菜单">
          <li v-for="(item, index) in menuItems" :key="item.to" class="menu-li">
            <RouterLink class="menu-item" :to="item.to">
              <Icon :icon="item.icon" class="menu-icon" aria-hidden="true" />
              <span class="menu-text">
                <span class="cn">{{ item.cn }}</span>
                <span class="en">{{ item.en }}</span>
              </span>
            </RouterLink>
          </li>
        </ul>
      </div>

      <div class="home-detail">
        <div v-if="!authStore.isAuthenticated" class="home-detail-card home-detail-card--ghost">
          <span class="feature-panel-kicker">SIGN IN</span>
          <strong>登录后保存进度与排行</strong>
          <p>登录后才能解锁多人对战、排行榜和房间续连。</p>
          <button class="home-detail-link" type="button" @click="openAuthModal('login')">
            <Icon icon="ph:sign-in-duotone" class="home-detail-link-icon" aria-hidden="true" />
            ENTER
          </button>
        </div>

        <div v-else class="home-detail-card home-identity-card">
          <span class="feature-panel-kicker">PLAYER</span>
          <div class="home-identity-header">
            <span class="home-identity-avatar">{{ authStore.playerId?.charAt(0)?.toUpperCase() }}</span>
            <strong class="home-identity-name">{{ authStore.playerId }}</strong>
            <span v-if="authStore.dbId != null" class="home-identity-dbid">#{{ authStore.dbId }}</span>
          </div>
          <div class="home-identity-stats">
            <div class="home-identity-stat">
              <span class="home-identity-stat-value">
                <Icon icon="ph:coin-duotone" class="home-stat-icon" aria-hidden="true" />
                {{ authStore.stats.score }}
              </span>
              <span class="home-identity-stat-label">积分</span>
            </div>
            <div class="home-identity-stat">
              <span class="home-identity-stat-value">
                <Icon icon="ph:crown-duotone" class="home-stat-icon" aria-hidden="true" />
                {{ authStore.stats.wins }}
              </span>
              <span class="home-identity-stat-label">胜场</span>
            </div>
            <div class="home-identity-stat">
              <span class="home-identity-stat-value">
                <Icon icon="ph:game-controller-duotone" class="home-stat-icon" aria-hidden="true" />
                {{ authStore.stats.matches }}
              </span>
              <span class="home-identity-stat-label">总场次</span>
            </div>
          </div>
          <div class="home-identity-links">
            <RouterLink class="home-detail-link" to="/auth">账号设置</RouterLink>
            <button class="home-detail-link" type="button" @click="handleLogout">退出登录</button>
          </div>
        </div>
      </div>

      <div class="home-social">
        <a href="https://github.com/xiaohuihui1022/Phrolova" target="_blank" rel="noopener" class="home-social-link">
          <Icon icon="ph:github-logo-duotone" /> GitHub
        </a>
        <span class="home-social-divider">·</span>
        <a href="https://phrolova.usotsuki-kaze.com/" target="_blank" rel="noopener" class="home-social-link">
          <Icon icon="ph:link-duotone" /> 友联
        </a>
        <span class="home-social-divider">·</span>
        <a target="_blank"
          href="https://qm.qq.com/cgi-bin/qm/qr?k=hYVfe1ReAYkgLM71ZkQMKABUu8641H-B&jump_from=webapi&authKey=WP+actLjZvH3Q6/JHDiDjU1xj7HpjXNxPSoCB9skVZnH1w0I6jzVf2lvnCCP7I/B">
          <Icon icon="ph:chat-circle-dots-duotone" /> QQ群 457323277
        </a>
      </div>
    </div>

    <ModalOverlay v-if="showAnnouncement" panel-class="announce-modal" max-width="480px" @close="closeAnnouncement">
      <div class="announce-content">
        <div class="announce-icon"><Icon icon="ph:megaphone-duotone" /></div>
        <h2 class="announce-title">网站全面升级公告</h2>
        <div class="announce-body">
          <p>欢迎来到「弗一把」！网站已进行全面的功能与 UI 升级，带来更好的游戏体验。</p>
          <div class="announce-section">
            <p class="announce-section-title"><Icon icon="ph:warning-circle-duotone" /> 老用户注意</p>
            <p>首次登录时会要求重置密码以升级安全策略，您可以重置为与原来相同的密码。</p>
          </div>
          <div class="announce-section">
            <p class="announce-section-title"><Icon icon="ph:chat-circle-dots-duotone" /> 加入官方QQ群</p>
            <p>群号：<strong>457323277</strong>，享受与群友对战、网站最新内容内测、问题反馈等专属功能！</p>
          </div>
        </div>
        <button class="announce-btn" type="button" @click="closeAnnouncement">
          <Icon icon="ph:check-circle-duotone" /> 我知道了
        </button>
      </div>
    </ModalOverlay>

    <ModalOverlay v-if="showAuthModal" panel-class="auth-modal" max-width="400px" @close="closeAuthModal">
      <header class="auth-modal-header">
        <p class="auth-modal-kicker">Account</p>
        <h2 class="auth-modal-title">{{ resetMode ? "密码升级" : (authMode === "login" ? "账号登录" : "创建账号") }}</h2>
      </header>

      <div v-if="localError || authStore.error" class="auth-modal-error">
        {{ localError || authStore.error }}
      </div>

      <div class="auth-modal-body">
        <!-- 密码升级表单（需验证旧密码） -->
        <template v-if="resetMode">
          <p class="auth-modal-hint">账号 <strong>{{ form.username }}</strong> 使用的是旧版密码格式。请输入旧密码验证身份后设置新密码。</p>

          <label class="auth-field">
            <span class="auth-field-label">旧密码</span>
            <input v-model="resetForm.oldPassword" class="auth-input" type="password" placeholder="输入当前密码验证身份" />
          </label>

          <label class="auth-field">
            <span class="auth-field-label">新密码</span>
            <input v-model="resetForm.newPassword" class="auth-input" type="password" placeholder="至少 6 位新密码" />
          </label>

          <label class="auth-field">
            <span class="auth-field-label">确认密码</span>
            <input v-model="resetForm.confirmPassword" class="auth-input" type="password" placeholder="再次输入新密码" />
          </label>

          <div class="auth-field">
            <span class="auth-field-label">验证码</span>
            <div class="auth-captcha-row">
              <div class="auth-captcha-box" @click="loadCaptcha">
                <img v-if="captchaImage" class="auth-captcha-img" :src="captchaImage" alt="验证码" />
                <span v-else class="auth-captcha-placeholder">点击加载</span>
              </div>
              <input v-model="resetForm.captchaText" class="auth-input" type="text" maxlength="5" placeholder="输入验证码" />
            </div>
          </div>

          <button class="auth-btn" type="button" :disabled="authStore.loading || upgrading" @click="submitResetPassword">
            {{ upgrading ? "正在验证..." : "确认升级密码" }}
          </button>

          <p class="auth-modal-foot">
            <button class="auth-switch-link" type="button" @click="resetMode = false">
              返回登录
            </button>
          </p>
        </template>

        <!-- 登录/注册表单 -->
        <template v-else>
          <div class="auth-tabs">
            <button class="auth-tab" :class="{ 'auth-tab--active': authMode === 'login' }" type="button" @click="authMode = 'login'">登录</button>
            <button class="auth-tab" :class="{ 'auth-tab--active': authMode === 'register' }" type="button" @click="authMode = 'register'">注册</button>
          </div>

          <label class="auth-field">
            <span class="auth-field-label">账号</span>
            <input v-model="form.username" class="auth-input" type="text" placeholder="输入账号名称" />
          </label>

          <label class="auth-field">
            <span class="auth-field-label">密码</span>
            <input v-model="form.password" class="auth-input" type="password" placeholder="至少 6 位密码" />
          </label>

          <div class="auth-field">
            <span class="auth-field-label">验证码</span>
            <div class="auth-captcha-row">
              <div class="auth-captcha-box" @click="loadCaptcha">
                <img v-if="captchaImage" class="auth-captcha-img" :src="captchaImage" alt="验证码" />
                <span v-else class="auth-captcha-placeholder">点击加载</span>
              </div>
              <input v-model="form.captchaText" class="auth-input" type="text" maxlength="5" placeholder="输入验证码" />
            </div>
          </div>

          <button class="auth-btn" type="button" :disabled="authStore.loading" @click="submitAuth">
            {{ authMode === "login" ? "确认登录" : "确认注册" }}
          </button>

          <p class="auth-modal-foot">
            {{ authMode === "login" ? "还没有账号？" : "已有账号？" }}
            <button class="auth-switch-link" type="button" @click="authMode = authMode === 'login' ? 'register' : 'login'">
              {{ authMode === "login" ? "去注册" : "去登录" }}
            </button>
          </p>
        </template>
      </div>
    </ModalOverlay>

    <Transition name="cookie-slide">
      <div v-if="showCookieConsent" class="cookie-consent" role="dialog" aria-label="Cookie 使用提示">
        <div class="cookie-consent-icon"><Icon icon="ph:cookie-duotone" /></div>
        <div class="cookie-consent-body">
          <p class="cookie-consent-title">Cookie 使用说明</p>
          <p class="cookie-consent-desc">本站使用 Cookie 保存您的登录状态，以便下次访问时自动保持登录。继续使用即表示您同意我们使用 Cookie。</p>
          <div class="cookie-consent-actions">
            <button class="cookie-consent-btn cookie-consent-btn--primary" type="button" @click="acceptCookies">
              <Icon icon="ph:check-circle-duotone" /> 同意
            </button>
            <button class="cookie-consent-btn cookie-consent-btn--ghost" type="button" @click="declineCookies">
              拒绝
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </section>
</template>

