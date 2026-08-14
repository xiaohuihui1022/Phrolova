<script setup lang="ts">
import { useRouter } from "vue-router";
import { Icon } from "@iconify/vue";
import { useI18n } from "vue-i18n";

const router = useRouter();
const { t } = useI18n();

// 共鸣者猜谜演示：目标「维里奈」→ 改为「弗洛洛」(湮灭,5,音感仪,黎那汐塔,2.5)，4 轮猜测
// 按规则：
// 版本差≤2 → near (橙色)，星级不同 → near
const resonatorDemo = {
  target: "弗洛洛",
  rounds: [
    {
      n: 1, name: "菲比",
      attribute: { v: "衍射", r: "diff" },
      stars: { v: 5, r: "match" },
      weapon: { v: "音感仪", r: "match" },
      birthplace: { v: "黎那汐塔", r: "match" },
      version: { v: "2.1", r: "near", arrow: "↑" },
    },
    {
      n: 2, name: "坎特蕾拉",
      attribute: { v: "湮灭", r: "match" },
      stars: { v: 5, r: "match" },
      weapon: { v: "音感仪", r: "match" },
      birthplace: { v: "黎那汐塔", r: "match" },
      version: { v: "2.2", r: "near", arrow: "↑" },
    },
    {
      n: 3, name: "露帕",
      attribute: { v: "热熔", r: "diff" },
      stars: { v: 5, r: "match" },
      weapon: { v: "长刃", r: "diff" },
      birthplace: { v: "黎那汐塔", r: "match" },
      version: { v: "2.4", r: "near", arrow: "↑" },
    },
    {
      n: 4, name: "弗洛洛",
      attribute: { v: "湮灭", r: "match" },
      stars: { v: 5, r: "match" },
      weapon: { v: "音感仪", r: "match" },
      birthplace: { v: "黎那汐塔", r: "match" },
      version: { v: "2.5", r: "match", arrow: "" },
      win: true,
    },
  ],
};

// 声骸双层反馈演示（词条颜色 + 单元格底色）
const skeletonDoubleDemo = {
  targetDropLocs: ["今州", "黑海岸"],
  rows: [
    {
      name: "cell-match",
      cell: "match",
      tokens: [
        { text: "今州", status: "match" },
        { text: "黑海岸", status: "match" },
      ],
      caption: "cell: match（数量对+全对）",
    },
    {
      name: "cell-partial",
      cell: "partial",
      tokens: [
        { text: "今州", status: "match" },
        { text: "云陵谷", status: "diff" },
      ],
      caption: "cell: partial（有命中，但数量/内容不全）",
    },
    {
      name: "cell-diff",
      cell: "different",
      tokens: [
        { text: "云陵谷", status: "diff" },
        { text: "荒芜之地", status: "diff" },
      ],
      caption: "cell: different（无命中）",
    },
  ],
};

// 声骸 COST 分组示例
const costGroups = [
  { cost: "3C", group: "A", members: ["轻波·巡水", "朔雷·鸣雷"] },
  { cost: "4C", group: "A", members: ["无声·咏叹", "熔山·裂空"] },
  { cost: "4C", group: "B", members: ["逆月·裁春", "残响·死回"] },
  { cost: "5C", group: "B", members: ["无冠者", "辉辉·终天"] },
];

// BO3 流程示例
const bo3Rounds = [
  { n: "R1", p1: "共鸣者·炽霞", p2: "***", winner: "P1" },
  { n: "R2", p1: "共鸣者·今汐", p2: "***", winner: "P2" },
  { n: "R3", p1: "共鸣者·维里奈", p2: "***", winner: "P1" },
];

// 准备→开始流程步骤
const readySteps = [
  { icon: "ph:user-plus-duotone", title: "步骤 1", desc: "2 名玩家齐聚房间" },
  { icon: "ph:check-circle-duotone", title: "步骤 2", desc: "非房主点击「准备」" },
  { icon: "ph:play-circle-duotone", title: "步骤 3", desc: "房主点击「开始对局」" },
];

// 对战参数卡片
const matchParams = [
  {
    icon: "ph:sparkle-duotone",
    titleKey: "rules.multiParamResonator",
    accent: "resonator",
    bullet: ["90 秒 / 局", "4 次猜测 / 人", "5 字段对比"],
  },
  {
    icon: "ph:sunglasses-duotone",
    titleKey: "rules.multiParamSkeleton",
    accent: "skeleton",
    bullet: ["150 秒 / 局", "8 次猜测 / 人", "5 字段对比"],
  },
];

function fbClass(r: string) {
  return r === "match" ? "rules-fb--match" : r === "near" ? "rules-fb--near" : r === "partial" ? "rules-fb--partial" : "rules-fb--diff";
}
function cellClass(r: string) {
  return r === "match" ? "demo-cell--match" : r === "partial" ? "demo-cell--partial" : "demo-cell--diff";
}
</script>

<template>
  <div class="rules-page">
    <!-- ═══════════ 顶栏 ═══════════ -->
    <header class="rules-top">
      <button class="back-btn" @click="router.push('/')">
        <Icon icon="ph:arrow-left-duotone" /> {{ t("leaderboard.back") }}
      </button>
      <h1 class="page-title">{{ t("rules.pageTitle") }}</h1>
      <div class="rules-top-right" />
    </header>

    <section class="page-heading">
      <p class="page-kicker">{{ t("rules.pageKicker") }}</p>
      <h2 class="page-title">{{ t("rules.pageTitle") }}</h2>
      <div class="page-ornament">
        <span />
        <Icon icon="ph:squares-four-duotone" class="ph" />
        <span />
      </div>
      <p class="page-desc">{{ t("rules.pageDesc") }}</p>
    </section>

    <div class="rules-grid">
      <!-- ═══════════ 单人演算 ═══════════ -->
      <section class="rules-section rules-section--span">
        <header class="rules-section-head">
          <span class="rules-section-num">01</span>
          <div class="rules-section-icon"><Icon icon="ph:user-duotone" /></div>
          <div>
            <h2>{{ t("rules.soloTitle") }}</h2>
            <span class="rules-section-en">{{ t("rules.soloEn") }}</span>
          </div>
        </header>

        <div class="rules-subgrid">
          <!-- 共鸣者 -->
          <div class="rules-col">
            <!-- 规则总览 -->
            <div class="rules-card">
              <div class="rules-card-head">
                <Icon icon="ph:sparkle-duotone" class="rules-card-icon rules-card-icon--resonator" />
                <div>
                  <h3>{{ t("rules.resonatorOverviewTitle") }}</h3>
                  <div class="rules-card-en">RESONATOR</div>
                </div>
              </div>
              <p>{{ t("rules.resonatorOverviewDesc") }}</p>
              <div class="rules-chip-row">
                <span class="rules-chip rules-chip--info">
                  <Icon icon="ph:target-duotone" /> 4 次猜测
                </span>
                <span class="rules-chip rules-chip--info">
                  <Icon icon="ph:squares-four-duotone" /> 5 个字段
                </span>
              </div>
            </div>

            <!-- 反馈颜色图例 -->
            <div class="rules-block">
              <h3 class="rules-block-title">
                <Icon icon="ph:palette-duotone" /> {{ t("rules.feedbackLegendTitle") }}
              </h3>
              <div class="rules-legend-list">
                <div class="rules-legend-item">
                  <span class="rules-fb rules-fb--match">{{ t("rules.fbMatch") }}</span>
                  <p class="rules-legend-desc">{{ t("rules.feedbackMatchRule") }}</p>
                </div>
                <div class="rules-legend-item">
                  <span class="rules-fb rules-fb--near">{{ t("rules.fbNear") }}</span>
                  <p class="rules-legend-desc">{{ t("rules.feedbackNearRule") }}</p>
                </div>
                <div class="rules-legend-item">
                  <span class="rules-fb rules-fb--diff">{{ t("rules.fbDiff") }}</span>
                  <p class="rules-legend-desc">{{ t("rules.feedbackDiffRule") }}</p>
                </div>
              </div>
            </div>

            <!-- 版本箭头提示 -->
            <div class="rules-block">
              <h3 class="rules-block-title">
                <Icon icon="ph:arrows-up-down-duotone" /> {{ t("rules.versionArrowTitle") }}
              </h3>
              <div class="rules-version-row">
                <div class="rules-version-item">
                  <span class="rules-version-arrow rules-version-arrow--up">↑</span>
                  <p>{{ t("rules.versionArrowUp") }}</p>
                </div>
                <div class="rules-version-item">
                  <span class="rules-version-arrow rules-version-arrow--down">↓</span>
                  <p>{{ t("rules.versionArrowDown") }}</p>
                </div>
              </div>
            </div>

            <!-- 猜谜示例（5 字段） -->
            <div class="rules-block">
              <h3 class="rules-block-title">
                <Icon icon="ph:table-duotone" /> {{ t("rules.resonatorDemoTitle") }}
              </h3>
              <p class="rules-block-sub">
                {{ t("rules.resonatorDemoTargetPrefix") }}
                <strong class="rules-emph">「{{ resonatorDemo.target }}」</strong>
                {{ t("rules.resonatorDemoTargetDesc") }}
              </p>

              <div class="demo-table-wrap">
                <table class="demo-table demo-table--wide">
                  <thead>
                    <tr>
                      <th>{{ t("rules.colIdx") }}</th>
                      <th>{{ t("rules.colGuess") }}</th>
                      <th>{{ t("rules.colAttribute") }}</th>
                      <th>{{ t("rules.colStar") }}</th>
                      <th>{{ t("rules.colWeapon") }}</th>
                      <th>{{ t("rules.colBirthplace") }}</th>
                      <th>{{ t("rules.colVersion") }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(r, i) in resonatorDemo.rounds" :key="i" :class="{ 'demo-win': r.win }">
                      <td class="demo-idx">{{ r.n }}</td>
                      <td class="demo-name">{{ r.name }}{{ r.win ? ' ✓' : '' }}</td>
                      <td><span class="rules-fb" :class="fbClass(r.attribute.r)">{{ r.attribute.v }}</span></td>
                      <td><span class="rules-fb" :class="fbClass(r.stars.r)">{{ r.stars.v }}★</span></td>
                      <td><span class="rules-fb" :class="fbClass(r.weapon.r)">{{ r.weapon.v }}</span></td>
                      <td><span class="rules-fb" :class="fbClass(r.birthplace.r)">{{ r.birthplace.v }}</span></td>
                      <td>
                        <span class="rules-fb" :class="fbClass(r.version.r)">
                          {{ r.version.v }}
                          <span v-if="r.version.arrow" class="rules-fb-arrow">{{ r.version.arrow }}</span>
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- 胜负判定 -->
            <div class="rules-block rules-block--accent">
              <h3 class="rules-block-title">
                <Icon icon="ph:trophy-duotone" /> {{ t("rules.winJudgeTitle") }}
              </h3>
              <p>{{ t("rules.winJudgeDesc") }}</p>
            </div>
          </div>

          <!-- 声骸 -->
          <div class="rules-col">
            <!-- 声骸总览 -->
            <div class="rules-card">
              <div class="rules-card-head">
                <Icon icon="ph:sunglasses-duotone" class="rules-card-icon rules-card-icon--skeleton" />
                <div>
                  <h3>{{ t("rules.skeletonOverviewTitle") }}</h3>
                  <div class="rules-card-en">ECHO · SOUND SKELETON</div>
                </div>
              </div>
              <p>{{ t("rules.skeletonOverviewDesc") }}</p>
              <div class="rules-chip-row">
                <span class="rules-chip rules-chip--info">
                  <Icon icon="ph:target-duotone" /> 8 次猜测
                </span>
                <span class="rules-chip rules-chip--info">
                  <Icon icon="ph:squares-four-duotone" /> 5 个字段
                </span>
              </div>
            </div>

            <!-- 简单模式 -->
            <div class="rules-block">
              <h3 class="rules-block-title">
                <Icon icon="ph:leaf-duotone" /> {{ t("rules.skeletonEasyTitle") }}
              </h3>
              <p>{{ t("rules.skeletonEasyDesc") }}</p>
              <div class="demo-cost-list">
                <div v-for="(g, i) in costGroups" :key="i" class="demo-cost-row" :class="`demo-cost-${g.group}`">
                  <span class="demo-cost-label">{{ g.cost }} · {{ g.group }}</span>
                  <span class="demo-cost-names">{{ g.members.join(' / ') }}</span>
                </div>
              </div>
            </div>

            <!-- 困难模式 + 双层反馈 -->
            <div class="rules-block">
              <h3 class="rules-block-title">
                <Icon icon="ph:flame-duotone" /> {{ t("rules.skeletonHardTitle") }}
              </h3>
              <p>{{ t("rules.skeletonHardDesc") }}</p>
            </div>

            <!-- 双层反馈机制 -->
            <div class="rules-block rules-block--layered">
              <h3 class="rules-block-title">
                <Icon icon="ph:stack-duotone" /> {{ t("rules.skeletonDoubleLayerTitle") }}
              </h3>

              <div class="rules-layer-grid">
                <div class="rules-layer-card">
                  <div class="rules-layer-chip rules-layer-chip--token">TOKEN</div>
                  <h4>{{ t("rules.skeletonTokenColor") }}</h4>
                  <div class="rules-layer-fbs">
                    <span class="rules-fb rules-fb--match">● match</span>
                    <span class="rules-fb rules-fb--near">● near</span>
                    <span class="rules-fb rules-fb--diff">● diff</span>
                  </div>
                </div>
                <div class="rules-layer-card">
                  <div class="rules-layer-chip rules-layer-chip--cell">CELL</div>
                  <h4>{{ t("rules.skeletonCellBg") }}</h4>
                  <div class="rules-layer-fbs">
                    <span class="rules-layer-bg rules-layer-bg--match">{{ t("rules.skeletonCellMatch") }}</span>
                    <span class="rules-layer-bg rules-layer-bg--partial">{{ t("rules.skeletonCellPartial") }}</span>
                    <span class="rules-layer-bg rules-layer-bg--diff">{{ t("rules.skeletonCellDiff") }}</span>
                  </div>
                </div>
              </div>

              <!-- 演示表格（以掉落位置为例，目标=今州+黑海岸） -->
              <div class="demo-table-wrap demo-table-wrap--tight">
                <table class="demo-table demo-table--echo">
                  <thead>
                    <tr>
                      <th style="width:80px">cell</th>
                      <th>tokens（示例：掉落位置）</th>
                      <th style="width:220px">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in skeletonDoubleDemo.rows" :key="row.name">
                      <td>
                        <span class="demo-cell" :class="cellClass(row.cell)">{{ row.cell }}</span>
                      </td>
                      <td>
                        <span
                          v-for="(tk, idx) in row.tokens"
                          :key="idx"
                          class="rules-fb rules-fb--token"
                          :class="fbClass(tk.status)"
                        >{{ tk.text }}</span>
                      </td>
                      <td class="demo-cell-desc">{{ row.caption }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- 判定细则 -->
            <div class="rules-ruleset">
              <div class="rules-ruleset-item">
                <h4 class="rules-ruleset-title"><Icon icon="ph:magic-wand-duotone" /> {{ t("rules.skeletonSkillAttrTitle") }}</h4>
                <ul class="rules-ruleset-list">
                  <li><span class="rules-fb rules-fb--match sm">match</span> {{ t("rules.skeletonSkillAttrMatch") }}</li>
                  <li><span class="rules-fb rules-fb--near sm">near</span> {{ t("rules.skeletonSkillAttrNear") }}</li>
                </ul>
              </div>
              <div class="rules-ruleset-item">
                <h4 class="rules-ruleset-title"><Icon icon="ph:map-pin-duotone" /> {{ t("rules.skeletonSetTitle") }}</h4>
                <ul class="rules-ruleset-list">
                  <li><span class="rules-fb rules-fb--match sm">match</span> {{ t("rules.skeletonSetMatch") }}</li>
                  <li><span class="rules-fb rules-fb--near sm">near</span> {{ t("rules.skeletonSetNear") }}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ═══════════ 多人对战 ═══════════ -->
      <section class="rules-section">
        <header class="rules-section-head">
          <span class="rules-section-num">02</span>
          <div class="rules-section-icon rules-section-icon--multi">
            <Icon icon="ph:users-three-duotone" />
          </div>
          <div>
            <h2>{{ t("rules.multiTitle") }}</h2>
            <span class="rules-section-en">{{ t("rules.multiEn") }}</span>
          </div>
        </header>

        <!-- 对战参数卡片 -->
        <div class="rules-param-grid">
          <div v-for="p in matchParams" :key="p.titleKey" class="rules-param-card" :class="`rules-param-card--${p.accent}`">
            <Icon :icon="p.icon" class="rules-param-icon" />
            <p class="rules-param-text">{{ t(p.titleKey) }}</p>
            <ul class="rules-param-bullet">
              <li v-for="(b, i) in p.bullet" :key="i">{{ b }}</li>
            </ul>
          </div>
        </div>

        <!-- 打码规则 + 胜负规则 -->
        <div class="rules-chip-row rules-chip-row--gap">
          <span class="rules-chip rules-chip--ghost">
            <Icon icon="ph:eye-slash-duotone" /> {{ t("rules.multiMaskRule") }}
          </span>
        </div>
        <p class="rules-multi-firstwin">
          <Icon icon="ph:flag-duotone" /> {{ t("rules.multiFirstWin") }}
        </p>

        <!-- BO3 示例 -->
        <div class="rules-block">
          <h3 class="rules-block-title">
            <Icon icon="ph:arrows-clockwise-duotone" /> {{ t("rules.bo3Title") }}
          </h3>
          <p>
            {{ t("rules.bo3DescPrefix") }}
            <strong class="rules-emph">{{ t("rules.bo3DescHidden") }}</strong>
            {{ t("rules.bo3DescSuffix") }}
          </p>
          <div class="demo-table-wrap">
            <table class="demo-table demo-table-compact">
              <thead>
                <tr>
                  <th>{{ t("rules.colRound") }}</th>
                  <th>{{ t("rules.colP1") }}</th>
                  <th>{{ t("rules.colP2") }}</th>
                  <th>{{ t("rules.colWinner") }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in bo3Rounds" :key="i">
                  <td class="demo-idx">{{ r.n }}</td>
                  <td class="demo-name">{{ r.p1 }}</td>
                  <td class="demo-name demo-masked">{{ r.p2 }}</td>
                  <td>
                    <span class="demo-winner-badge" :class="r.winner === 'P1' ? 'demo-winner-me' : 'demo-winner-opp'">{{ r.winner }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="demo-hint"><em>{{ t("rules.bo3Hint") }}</em></p>
        </div>

        <!-- 创建房间 & 加入房间 -->
        <div class="rules-block">
          <h3 class="rules-block-title">
            <Icon icon="ph:door-open-duotone" /> {{ t("rules.createRoomTitle") }}
          </h3>
          <p>{{ t("rules.createRoomDesc") }}</p>
        </div>

        <!-- 准备 → 开始流程 -->
        <div class="rules-block rules-block--flow">
          <h3 class="rules-block-title">
            <Icon icon="ph:flow-arrow-duotone" /> {{ t("rules.readyFlowTitle") }}
          </h3>
          <div class="rules-flow">
            <template v-for="(s, i) in readySteps" :key="i">
              <div class="rules-flow-step">
                <span class="rules-flow-num">{{ i + 1 }}</span>
                <div class="rules-flow-ico"><Icon :icon="s.icon" /></div>
                <div class="rules-flow-body">
                  <div class="rules-flow-title">{{ s.title }}</div>
                  <p class="rules-flow-desc">{{ s.desc }}</p>
                </div>
              </div>
              <div v-if="i < readySteps.length - 1" class="rules-flow-arrow">
                <Icon icon="ph:caret-right-duotone" />
              </div>
            </template>
          </div>
          <p class="rules-flow-sub">{{ t("rules.readyFlowDesc") }}</p>
        </div>

        <div class="rules-block">
          <h3 class="rules-block-title">
            <Icon icon="ph:sign-in-duotone" /> {{ t("rules.joinRoomTitle") }}
          </h3>
          <p>{{ t("rules.joinRoomDesc") }}</p>
        </div>
        <div class="rules-block">
          <h3 class="rules-block-title">
            <Icon icon="ph:dice-five-duotone" /> {{ t("rules.randomMatchTitle") }}
          </h3>
          <p>{{ t("rules.randomMatchDesc") }}</p>
        </div>

        <!-- 继续游戏 / 再战 -->
        <div class="rules-block rules-block--rematch">
          <h3 class="rules-block-title">
            <Icon icon="ph:repeat-once-duotone" /> {{ t("rules.rematchTitle") }}
          </h3>
          <div class="rules-rematch-grid">
            <div class="rules-rematch-card rules-rematch-card--random">
              <Icon icon="ph:dice-five-duotone" class="rules-rematch-icon" />
              <p class="rules-rematch-label">随机匹配</p>
              <p>{{ t("rules.rematchRandomMatch") }}</p>
            </div>
            <div class="rules-rematch-card rules-rematch-card--host">
              <Icon icon="ph:door-open-duotone" class="rules-rematch-icon" />
              <p class="rules-rematch-label">创建房间</p>
              <p>{{ t("rules.rematchCreateRoom") }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- ═══════════ 积分结算 + 对局判定 ═══════════ -->
      <section class="rules-section">
        <header class="rules-section-head">
          <span class="rules-section-num">03</span>
          <div class="rules-section-icon rules-section-icon--score">
            <Icon icon="ph:trophy-duotone" />
          </div>
          <div>
            <h2>{{ t("rules.scoringTitle") }} &amp; {{ t("rules.matchRulesTitle") }}</h2>
            <span class="rules-section-en">{{ t("rules.scoringEn") }} · {{ t("rules.matchRulesEn") }}</span>
          </div>
        </header>

        <!-- 三张积分表 -->
        <div class="rules-score-cards">
          <div class="rules-score-card rules-score-card--resonator">
            <h4><Icon icon="ph:sparkle-duotone" /> {{ t("rules.scoringResonatorTitle") }}</h4>
            <table class="rules-score-table">
              <tr><td>BO1</td><td>±10</td></tr>
              <tr><td>BO3</td><td>±30</td></tr>
              <tr><td>BO5</td><td>±50</td></tr>
            </table>
          </div>
          <div class="rules-score-card rules-score-card--easy">
            <h4><Icon icon="ph:leaf-duotone" /> {{ t("rules.scoringSkeletonEasyTitle") }}</h4>
            <table class="rules-score-table">
              <tr><td>BO1</td><td>±5</td></tr>
              <tr><td>BO3</td><td>±10</td></tr>
              <tr><td>BO5</td><td>±15</td></tr>
            </table>
          </div>
          <div class="rules-score-card rules-score-card--hard">
            <h4><Icon icon="ph:flame-duotone" /> {{ t("rules.scoringSkeletonHardTitle") }}</h4>
            <table class="rules-score-table">
              <tr><td>BO1</td><td>±30</td></tr>
              <tr><td>BO3</td><td>±50</td></tr>
              <tr><td>BO5</td><td>±70</td></tr>
            </table>
          </div>
        </div>

        <!-- 结算示例 -->
        <div class="rules-block rules-block-example">
          <h3 class="rules-block-title">
            <Icon icon="ph:calculator-duotone" /> {{ t("rules.scoringExampleTitle") }}
          </h3>
          <p>{{ t("rules.scoringExampleDesc") }}</p>
          <div class="demo-settle">
            <div class="demo-settle-row">
              <span><Icon icon="ph:game-controller-duotone" class="demo-settle-icon" /> {{ t("rules.settleMode") }}</span>
              <span class="demo-settle-val">{{ t("rules.settleModeVal") }}</span>
            </div>
            <div class="demo-settle-row">
              <span><Icon icon="ph:medal-duotone" class="demo-settle-icon" /> {{ t("rules.settleResult") }}</span>
              <span class="demo-settle-val demo-win">{{ t("rules.settleResultWin") }}</span>
            </div>
            <div class="demo-settle-row">
              <span><Icon icon="ph:trend-up-duotone" class="demo-settle-icon" /> {{ t("rules.settleScoreChange") }}</span>
              <span class="demo-settle-val demo-plus">+30</span>
            </div>
          </div>
        </div>

        <!-- 对局判定 4 条 -->
        <div class="rules-judge-grid">
          <div class="rules-judge-card">
            <h4><Icon icon="ph:sign-out-duotone" class="rules-judge-icon rules-judge-icon--red" /> {{ t("rules.forfeitTitle") }}</h4>
            <p>{{ t("rules.forfeitDesc") }}</p>
          </div>
          <div class="rules-judge-card">
            <h4><Icon icon="ph:wifi-slash-duotone" class="rules-judge-icon rules-judge-icon--warn" /> {{ t("rules.reconnectTitle") }}</h4>
            <p>{{ t("rules.reconnectDesc") }}</p>
          </div>
          <div class="rules-judge-card">
            <h4><Icon icon="ph:handshake-duotone" class="rules-judge-icon rules-judge-icon--blue" /> {{ t("rules.drawTitle") }}</h4>
            <p>{{ t("rules.drawDesc") }}</p>
          </div>
          <div class="rules-judge-card">
            <h4><Icon icon="ph:seal-check-duotone" class="rules-judge-icon rules-judge-icon--green" /> {{ t("rules.scoreProtectTitle") }}</h4>
            <p>{{ t("rules.scoreProtectDesc") }}</p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
