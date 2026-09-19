import { test, expect, type Page } from '@playwright/test';

/**
 * Nexus Flow 设计器 E2E 测试
 *
 * 覆盖三条链路：
 * 1. 冒烟：登录进入设计器
 * 2. 核心链路：新流程 → 画图（节点 + 连线）→ 保存 → 版本管理 → 恢复版本
 * 3. 工作台与批量编辑：流程重命名 / 删除确认 / 多选批量设置审批人
 *
 * 选择器说明：
 * - LogicFlow 2.x 节点根元素是 g.lf-node（没有按类型区分的 class）
 * - 画布常驻显示 MiniMap，小地图内部也有一份 .lf-graph / g.lf-node 克隆，
 *   所以主画布相关选择器统一用 :not(.lf-mini-map-graph *) 排除小地图
 */

// 演示模式下登录表单自带默认账号，直接提交即可
async function login(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  // 登录成功后跳转设计器，标题为默认激活流程「请假审批」
  await expect(page.locator('.workspace-hero h1')).toHaveText('请假审批', { timeout: 15000 });
}

// 主画布上的节点（排除小地图克隆）
const canvasNodes = (page: Page) => page.locator('g.lf-node:not(.lf-mini-map-graph *)');
// 主画布（排除小地图）
const mainGraph = (page: Page) => page.locator('.lf-graph:not(.lf-mini-map-graph *)');

// hero 区域的统计数字：第 1 个是节点数，第 2 个是连线数
const nodeCountStat = (page: Page) => page.locator('.workspace-hero__stats strong').first();
const edgeCountStat = (page: Page) => page.locator('.workspace-hero__stats strong').nth(1);

test.describe('冒烟', () => {
  test('登录后进入设计器，工作台包含默认流程', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('button', { name: '保存流程' })).toBeVisible();
    await expect(page.locator('.workspace-flow-tab')).toHaveCount(2);
  });
});

test.describe('核心链路', () => {
  test('新流程 → 画图 → 保存 → 恢复版本', async ({ page }) => {
    await login(page);

    // 新建独立流程：id 全新，mock 无数据，画布必然为空，与其他用例隔离
    await page.getByRole('button', { name: '新流程' }).click();
    await expect(page.locator('.workspace-hero h1')).toContainText('新流程');

    // 新增两个节点
    const addNodeBtn = page.getByRole('button', { name: '新增节点' });
    await addNodeBtn.click();
    await addNodeBtn.click();
    await expect(nodeCountStat(page)).toHaveText('2');

    // 拖拽连线：先单击选中源节点（拖拽起始时选中态不再变化，锚点 DOM 不会被
    // LogicFlow 重建，否则 pointerup 时锚点组件实例失效会导致连线丢弃），
    // 悬停后锚点可见，取最靠右的锚点作为连线起点
    const nodeA = canvasNodes(page).nth(0);
    const nodeB = canvasNodes(page).nth(1);
    await nodeA.click();
    await nodeA.hover();
    const rightAnchor = await nodeA.locator('circle.lf-node-anchor').evaluateAll((els) => {
      let best: { x: number; y: number } | null = null;
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        if (!best || cx > best.x) {
          best = { x: cx, y: rect.top + rect.height / 2 };
        }
      }
      return best!;
    });
    const boxB = (await nodeB.boundingBox())!;
    await page.mouse.move(rightAnchor.x, rightAnchor.y);
    await page.mouse.down();
    await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(edgeCountStat(page)).toHaveText('1');

    // 保存流程：校验通过（2 节点 1 连线是合法流程），并自动生成版本快照
    // （Element Plus 消息 3s 内堆叠共存，必须按文本过滤，否则 strict mode 报多重匹配）
    await page.getByRole('button', { name: '保存流程' }).click();
    await expect(page.locator('.el-message--success', { hasText: '流程保存成功' })).toBeVisible();

    // 打开版本管理，应有一条「正式保存」快照
    await page.getByRole('button', { name: '版本管理' }).click();
    await expect(page.locator('.version-card')).toHaveCount(1);
    await expect(page.locator('.version-card').first()).toContainText('正式保存');

    // 关闭抽屉，删掉一个节点，让画布偏离已保存版本
    await page.locator('.el-drawer__close-btn').click();
    // 抽屉用 v-show 渲染（不会从 DOM 卸载，只会隐藏）：等它隐藏完成再操作，
    // 关闭动画期间画布快捷键被有意屏蔽，立刻按 Delete 会不稳定
    await page.locator('.el-drawer').waitFor({ state: 'hidden' });
    // 抽屉关闭后焦点回到 body；删除快捷键挂在 document 级，无需画布焦点也能生效
    await canvasNodes(page).first().click();
    await page.keyboard.press('Delete');
    await expect(nodeCountStat(page)).toHaveText('1');

    // 重新打开版本管理，恢复最初保存的版本
    await page.getByRole('button', { name: '版本管理' }).click();
    await page.locator('.version-card .version-card__actions button', { hasText: '恢复' }).first().click();

    // 恢复前的确认弹窗（恢复前会自动备份当前内容）
    const confirmBox = page.locator('.el-message-box');
    await expect(confirmBox).toContainText('恢复后当前画布会被覆盖');
    await confirmBox.getByRole('button', { name: '恢复' }).click();
    await expect(page.locator('.el-message--success', { hasText: '版本已恢复' })).toBeVisible();

    // 画布应回到 2 节点 1 连线
    await expect(nodeCountStat(page)).toHaveText('2');
    await expect(edgeCountStat(page)).toHaveText('1');
  });
});

test.describe('工作台与批量编辑', () => {
  test('流程重命名与删除确认', async ({ page }) => {
    await login(page);

    // hover 流程 tab 出现 ✎/✕ 操作按钮，点击 ✎ 触发重命名弹窗
    const tab = page.locator('.workspace-flow-tab', { hasText: '报销流程' });
    await tab.hover();
    await tab.locator('.workspace-flow-tab__action').first().click();

    await page.locator('.el-message-box__input input').fill('报销流程-E2E');
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click();
    await expect(
      page.locator('.workspace-flow-tab', { hasText: '报销流程-E2E' }),
    ).toBeVisible();

    // 点击 ✕ 弹出删除确认，点取消后流程仍存在
    const renamedTab = page.locator('.workspace-flow-tab', { hasText: '报销流程-E2E' });
    await renamedTab.hover();
    await renamedTab.locator('.workspace-flow-tab__action.is-danger').click();

    const dialog = page.locator('.el-message-box');
    await expect(dialog).toContainText('本地草稿和版本记录会一并删除');
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(renamedTab).toBeVisible();
  });

  test('多选批量设置审批人', async ({ page }) => {
    await login(page);

    // 新流程 + 两个节点，保证画布状态可控
    await page.getByRole('button', { name: '新流程' }).click();
    const addNodeBtn = page.getByRole('button', { name: '新增节点' });
    await addNodeBtn.click();
    await addNodeBtn.click();
    await expect(nodeCountStat(page)).toHaveText('2');

    // Ctrl+A 全选（快捷键监听在 document 级，不依赖画布焦点）
    await page.keyboard.press('Control+a');

    // 右侧属性面板切换为批量编辑表单
    const batch = page.locator('.property-panel__batch');
    await expect(batch).toContainText('已选中 2 个节点');

    // 勾选「审批人」并填写，批量应用
    // （输入框用 placeholder 定位：行内还有 checkbox 的隐藏 input，不能用 input first()）
    await batch.locator('.el-checkbox').first().click();
    await batch.getByPlaceholder('统一设置审批人').fill('批量审批人');
    await page.getByRole('button', { name: '批量应用' }).click();
    await expect(page.locator('.el-message--success', { hasText: '已批量更新 2 个节点' })).toBeVisible();

    // 点画布左下角空白取消选择（小地图在右下角），再单选一个节点，验证审批人已写入属性表单
    const canvas = mainGraph(page);
    const canvasBox = (await canvas.boundingBox())!;
    await canvas.click({ position: { x: 30, y: canvasBox.height - 30 } });
    await canvasNodes(page).first().click();
    await expect(page.getByPlaceholder('请输入审批人')).toHaveValue('批量审批人');
  });
});
