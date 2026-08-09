// 声骸分组数据（迁移自 Python divide.json）
// 属性分组 -> 套装名列表；版本分组 -> 区域名列表

export const DIVIDE_DATA: Record<string, string[]> = {
  衍射: ['逆光跃彩之约', '流金溯真之式', '浮星祛暗', '此间永驻之光'],
  热熔: ['冥途夜行之灯', '斑驳粉饰之沫', '长路启航之星', '熔山裂谷', '奔狼燎原之焰', '焚羽猎魔之影'],
  冷凝: ['剪心辑梦之影', '雪落无声之愿', '凝夜白霜', '凌冽决断之心'],
  导电: ['彻空冥雷'],
  湮灭: ['沉日劫明', '幽夜隐匿之帷', '失序彼岸之梦', '命理崩毁之弦'],
  气动: ['清邪荡煞之心', '听唤语义之愿', '星构寻辉之环', '啸谷长风', '隐世回光', '流云逝尽之空', '愿戴荣光之旅'],
  全属性: ['羽落空尘之歌', '轻云出月', '无惧浪涛之勇'],
  '1.0': ['今州', '黑海岸'],
  '2.0': ['拉古那', '七丘', '隐海试炼场'],
  '3.0': ['拉海洛', '罗伊冰原'],
  '3.5': ['梦州'],
};

// 构建反向索引：套装 -> 属性集合（用于 skill_attribute 推断）
export function buildDivideSetToAttrs(): Record<string, Set<string>> {
  const result: Record<string, Set<string>> = {};
  for (const [groupName, members] of Object.entries(DIVIDE_DATA)) {
    // 只处理属性分组（字母/中文开头且不是版本号格式）
    if (/^\d/.test(groupName)) continue;
    if (groupName === '全属性') continue;
    for (const member of members) {
      const key = member.trim();
      if (!key) continue;
      if (!result[key]) result[key] = new Set();
      result[key].add(groupName);
    }
  }
  return result;
}

// 构建反向索引：区域/套装 -> 所属分组集合（用于 drop_location 近邻判断）
export function buildDivideMemberGroups(): Record<string, Set<string>> {
  const result: Record<string, Set<string>> = {};
  for (const [groupName, members] of Object.entries(DIVIDE_DATA)) {
    for (const member of members) {
      const key = member.trim();
      if (!key) continue;
      if (!result[key]) result[key] = new Set();
      result[key].add(groupName);
    }
  }
  return result;
}
