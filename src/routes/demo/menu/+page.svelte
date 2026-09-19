<script lang="ts">
	import { onMount } from 'svelte';
	import {
		contextMenu,
		listMenuIds,
		registerMenuItems,
		type MenuItem
	} from '#lib/components/contextMenu/contextMenu.svelte';

	// 右键菜单的活体示例：命令项（带 keyBind 提示）、禁用项、分隔项、子菜单
	// （含二级子菜单）与 `when` 可见性。菜单节点只引用命令 id，真正的命令注册表
	// 是后面的 T1 工作（见 docs / handoff），这里把动作直接内联成 action。
	let showAdvanced = $state(true);
	let lastAction = $state('（还没有执行命令）');
	let registeredMenuIds = $state<string[]>([]);

	const menuId = 'gpen-demo-menu';

	onMount(() => {
		// 具名注册：`contextMenu` action 只把 DOM 关联到这个名字，provider 由
		// 注册表持有，所以 palette / 测试也能按名字枚举到它。
		const dispose = registerMenuItems(menuId, demoMenu);
		registeredMenuIds = listMenuIds();
		return dispose;
	});

	function demoMenu(): MenuItem[] {
		return [
			{
				id: 'demo.draw',
				label: '绘制笔画',
				keyBind: ['Shift', 'Space'],
				order: 10,
				action: () => (lastAction = 'demo.draw')
			},
			{
				id: 'demo.duplicate',
				label: '复制图层',
				keyBind: 'Ctrl+Shift+D',
				order: 20,
				action: () => (lastAction = 'demo.duplicate')
			},
			{
				id: 'demo.locked',
				label: '锁定图层（禁用示例）',
				order: 30,
				disabled: true,
				action: () => (lastAction = 'demo.locked')
			},
			{ separator: true, order: 40 },
			{
				id: 'demo.brush',
				label: '画笔',
				order: 50,
				children: [
					{
						id: 'demo.brush.size',
						label: '尺寸 +10',
						action: () => (lastAction = 'demo.brush.size')
					},
					{
						id: 'demo.brush.hardness',
						label: '硬度',
						children: [
							{
								id: 'demo.brush.hardness.soft',
								label: '柔边',
								action: () => (lastAction = 'demo.brush.hardness.soft')
							},
							{
								id: 'demo.brush.hardness.hard',
								label: '硬边',
								action: () => (lastAction = 'demo.brush.hardness.hard')
							}
						]
					},
					{ separator: true },
					{
						id: 'demo.brush.reset',
						label: '重置画笔',
						action: () => (lastAction = 'demo.brush.reset')
					}
				]
			},
			{
				id: 'demo.advanced',
				label: '高级选项（when 示例）',
				order: 60,
				when: showAdvanced,
				action: () => (lastAction = 'demo.advanced')
			}
		];
	}
</script>

<svelte:head><title>Context menu · gpen</title></svelte:head>

<main>
	<header class="page-header">
		<h1>右键菜单</h1>
		<p>
			右键（触摸设备长按）下面的方块打开菜单。已注册的具名菜单 id：
			<code>{registeredMenuIds.join(', ') || '（无）'}</code>
		</p>
	</header>

	<label class="toggle">
		<input type="checkbox" bind:checked={showAdvanced} />
		显示「高级选项」（菜单打开后再切换需要重新打开）
	</label>

	<div class="target" use:contextMenu={menuId} data-testid="menu-target">
		<span>在此右键 / 长按</span>
	</div>

	<p class="result" data-testid="menu-result">最后执行的命令：{lastAction}</p>
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		gap: 2lh;
		max-width: 72ch;
		margin: 0 auto;
		padding: 4lh 2ch;
	}

	.page-header h1 {
		margin: 0 0 1lh;
	}

	.page-header p {
		margin: 0;
		color: var(--gpen-panel-muted);
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: 1ch;
	}

	.target {
		display: grid;
		place-items: center;
		min-height: 12lh;
		border: 1px dashed var(--gpen-panel-border);
		border-radius: var(--gpen-radius);
		background: var(--gpen-panel-background-raised);
		color: var(--gpen-panel-foreground);
	}

	.result {
		margin: 0;
		color: var(--gpen-panel-muted);
	}
</style>
