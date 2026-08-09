<script setup lang="ts">
import { useRouter } from "vue-router";
import { Icon } from "@iconify/vue";

const router = useRouter();

// 共鸣者猜谜演示：目标「维里奈」(无音,5,长刀)，4 轮猜测
const resonatorDemo = {
  target: "维里奈",
  rounds: [
    { n: 1, name: "炽霞",    attribute: { v: "热熔", r: "diff" },  stars: { v: 4, r: "diff" }, weapon: { v: "佩枪", r: "diff" } },
    { n: 2, name: "今汐",    attribute: { v: "衍射", r: "diff" },  stars: { v: 5, r: "match" }, weapon: { v: "长刀", r: "match" } },
    { n: 3, name: "卡提希娅", attribute: { v: "无音", r: "match" }, stars: { v: 5, r: "match" }, weapon: { v: "佩枪", r: "diff" } },
    { n: 4, name: "维里奈",  attribute: { v: "无音", r: "match" }, stars: { v: 5, r: "match" }, weapon: { v: "长刀", r: "match" }, win: true },
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

function fbClass(r: string) {
  return r === "match" ? "rules-fb--match" : r === "near" ? "rules-fb--near" : "rules-fb--diff";
}
</script>

<template>
  <div class="rules-page">
    <header class="rules-top">
      <button class="back-btn" @click="router.push('/')">
        <Icon icon="ph:arrow-left-duotone" /> BACK
      </button>
      <h1 class="page-title">玩法规则</h1>
      <div class="rules-top-right" />
    </header>

    <section class="page-heading">
      <p class="page-kicker">Phrolova · Play Rules</p>
      <p class="page-desc">快速了解单人演算与多人对战的核心机制</p>
    </section>

    <div class="rules-grid">
      <!-- ═══════════ 单人演算 ═══════════ -->
      <section class="rules-section">
        <header class="rules-section-head">
          <div class="rules-section-icon"><Icon icon="ph:user-duotone" /></div>
          <div>
            <h2>单人演算</h2>
            <span class="rules-section-en">SOLO MODE</span>
          </div>
        </header>

        <div class="rules-block">
          <h3>共鸣者 · 猜谜示例</h3>
          <p>目标角色：<strong class="rules-emph">「{{ resonatorDemo.target }}」</strong>（无音 · 5 星 · 长刀）。每轮猜测比较三列字段，颜色表示与目标的匹配度。</p>

          <div class="demo-table-wrap">
            <table class="demo-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>猜测角色</th>
                  <th>属性</th>
                  <th>星级</th>
                  <th>武器</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in resonatorDemo.rounds" :key="i" :class="{ 'demo-win': r.win }">
                  <td class="demo-idx">{{ r.n }}</td>
                  <td class="demo-name">{{ r.name }}{{ r.win ? ' ✓' : '' }}</td>
                  <td><span class="rules-fb" :class="fbClass(r.attribute.r)">{{ r.attribute.v }}</span></td>
                  <td><span class="rules-fb" :class="fbClass(r.stars.r)">{{ r.stars.v }}★</span></td>
                  <td><span class="rules-fb" :class="fbClass(r.weapon.r)">{{ r.weapon.v }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="rules-feedback">
            <span class="rules-fb rules-fb--match">完全匹配</span>
            <span class="rules-fb rules-fb--near">部分匹配</span>
            <span class="rules-fb rules-fb--diff">完全不同</span>
          </div>
        </div>

        <div class="rules-block">
          <h3>声骸 · 简单（分组色彩）</h3>
          <p>同组同色，跨组异色。示例展示 COST 与分组的关系：</p>
          <div class="demo-cost-list">
            <div v-for="(g, i) in costGroups" :key="i" class="demo-cost-row" :class="`demo-cost-${g.group}`">
              <span class="demo-cost-label">{{ g.cost }} · {{ g.group }}</span>
              <span class="demo-cost-names">{{ g.members.join(' / ') }}</span>
            </div>
          </div>
        </div>

        <div class="rules-block">
          <h3>声骸 · 困难</h3>
          <p>反馈技能属性、所属套装、掉落位置三类信息，每种反馈以独立颜色区分。异相与套装使用分组色彩标记。</p>
        </div>

        <div class="rules-block">
          <h3>胜负判定</h3>
          <p>在限制次数内猜对即获胜，次数越少得分越高。未猜中则本局结束。</p>
        </div>
      </section>

      <!-- ═══════════ 多人对战 ═══════════ -->
      <section class="rules-section">
        <header class="rules-section-head">
          <div class="rules-section-icon"><Icon icon="ph:users-three-duotone" /></div>
          <div>
            <h2>多人对战</h2>
            <span class="rules-section-en">MULTIPLAYER</span>
          </div>
        </header>

        <div class="rules-block">
          <h3>BO3 · 回合流程示例</h3>
          <p>赛制：BO3（先赢 2 回合获胜）。<strong class="rules-emph">对手名称以 *** 隐藏</strong>，但反馈颜色完整可见。</p>

          <div class="demo-table-wrap">
            <table class="demo-table demo-table-compact">
              <thead>
                <tr>
                  <th>回合</th>
                  <th>P1（你）</th>
                  <th>P2（对手）</th>
                  <th>胜者</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in bo3Rounds" :key="i">
                  <td class="demo-idx">{{ r.n }}</td>
                  <td class="demo-name">{{ r.p1 }}</td>
                  <td class="demo-name demo-masked">{{ r.p2 }}</td>
                  <td><span class="demo-winner-badge" :class="r.winner === 'P1' ? 'demo-winner-me' : 'demo-winner-opp'">{{ r.winner }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="demo-hint"><em>注：每回合结束后双方各自查看完整反馈表。P1 最终以 2:1 赢得整场对战。</em></p>
        </div>

        <div class="rules-block">
          <h3>创建房间</h3>
          <p>房主选择题型（共鸣者 / 声骸）与赛制（BO1 / BO3 / BO5），生成 6 位房间码邀请对手。</p>
        </div>
        <div class="rules-block">
          <h3>加入房间</h3>
          <p>输入房间码加入已有房间，双方就绪后房主启动对局。</p>
        </div>
        <div class="rules-block">
          <h3>随机匹配</h3>
          <p>系统自动匹配在线玩家，固定采用 BO3 赛制。匹配成功即进入房间。</p>
        </div>
      </section>

      <!-- ═══════════ 积分结算 ═══════════ -->
      <section class="rules-section">
        <header class="rules-section-head">
          <div class="rules-section-icon"><Icon icon="ph:trophy-duotone" /></div>
          <div>
            <h2>积分结算</h2>
            <span class="rules-section-en">SCORING</span>
          </div>
        </header>

        <div class="rules-block">
          <h3>共鸣者</h3>
          <table class="rules-score-table">
            <tr><td>BO1</td><td>±10</td></tr>
            <tr><td>BO3</td><td>±30</td></tr>
            <tr><td>BO5</td><td>±50</td></tr>
          </table>
        </div>
        <div class="rules-block">
          <h3>声骸 · 简单</h3>
          <table class="rules-score-table">
            <tr><td>BO1</td><td>±5</td></tr>
            <tr><td>BO3</td><td>±10</td></tr>
            <tr><td>BO5</td><td>±15</td></tr>
          </table>
        </div>
        <div class="rules-block">
          <h3>声骸 · 困难</h3>
          <table class="rules-score-table">
            <tr><td>BO1</td><td>±30</td></tr>
            <tr><td>BO3</td><td>±50</td></tr>
            <tr><td>BO5</td><td>±70</td></tr>
          </table>
        </div>

        <div class="rules-block rules-block-example">
          <h3>结算示例</h3>
          <p>你在共鸣者 BO3 中 2:1 战胜对手：</p>
          <div class="demo-settle">
            <div class="demo-settle-row"><span>对战模式</span><span class="demo-settle-val">共鸣者 · BO3</span></div>
            <div class="demo-settle-row"><span>对战结果</span><span class="demo-settle-val demo-win">胜（2 : 1）</span></div>
            <div class="demo-settle-row"><span>积分变动</span><span class="demo-settle-val demo-plus">+30</span></div>
          </div>
        </div>
      </section>

      <!-- ═══════════ 对局判定 ═══════════ -->
      <section class="rules-section">
        <header class="rules-section-head">
          <div class="rules-section-icon"><Icon icon="ph:gavel-duotone" /></div>
          <div>
            <h2>对局判定</h2>
            <span class="rules-section-en">MATCH RULES</span>
          </div>
        </header>

        <div class="rules-block">
          <h3>逃逸判定</h3>
          <p>主动退出对战视为逃逸，对方直接赢得整场并全额结算积分。逃逸者按对应模式扣减。</p>
        </div>
        <div class="rules-block">
          <h3>断线重连</h3>
          <p>异常断线后有 60 秒重连窗口，超时未恢复按逃逸处理。返回首页可使用「恢复房间」续接。</p>
        </div>
        <div class="rules-block">
          <h3>平局处理</h3>
          <p>BO1 中若双方均未在限制次数内猜对，判定平局，双方积分不变。BO3 / BO5 允许单回合平局，继续下一回合。</p>
        </div>
        <div class="rules-block">
          <h3>积分保护</h3>
          <p>每日最多结算 5 场有效对局，超过后积分不再变动，避免异常刷分。</p>
        </div>
      </section>
    </div>
  </div>
</template>
