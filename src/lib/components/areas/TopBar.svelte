<script lang="ts">
	const menuItems = ['文件', '编辑', '渲染', '窗口', '帮助', '切换', '实用工具', '设置'];
</script>

<div class="blender-panel blender-panel-menu" aria-label="Blender 菜单和工具设置">
	<div class="menu-row">
		<nav class="menu-items" aria-label="主菜单">
			{#each menuItems as item}
				<button type="button">{item}</button>
			{/each}
		</nav>
		<button class="workspace-switcher" type="button">2D Animation⌄</button>
	</div>

	<div class="tool-settings" aria-label="工具设置">
		<button class="setting-control setting-tool" type="button"><span aria-hidden="true">◒</span> Airbrush <span class="chevron" aria-hidden="true">⌄</span></button>
		<div class="setting-control setting-muted">Airbrush</div>
		<button class="setting-control" type="button">尺寸 <strong>0.15 m</strong><span class="setting-icon" aria-hidden="true">◌</span></button>
		<button class="setting-control setting-value" type="button">强度/力度 <strong>0.400</strong><span class="setting-icon" aria-hidden="true">◌</span></button>
		<button class="setting-control setting-icon-only" type="button" aria-label="笔触选项">◡</button>
		<button class="setting-control" type="button">高级⌄</button>
		<button class="setting-control" type="button">笔画⌄</button>
		<button class="setting-control" type="button">游标⌄</button>
	</div>
</div>

<style>
	.blender-panel {
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		font: 12px/1.2 var(--gpen-font-sans);
	}

	.blender-panel-menu {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: #3d3d3d;
		color: #eee;
	}

	.menu-row,
	.tool-settings {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.menu-row {
		height: 1.75lh;
		padding: 0 1ch;
		background: #303030;
	}

	.menu-items {
		display: flex;
		align-items: stretch;
		gap: 1px;
		height: 100%;
		min-width: 0;
	}

	.menu-items button,
	.workspace-switcher,
	.setting-control {
		border: 0;
		border-radius: 2px;
		background: transparent;
		color: inherit;
		font: inherit;
		white-space: nowrap;
		cursor: pointer;
	}

	.menu-items button,
	.workspace-switcher {
		padding: 0 1.25ch;
	}

	.menu-items button:hover,
	.menu-items button:focus-visible,
	.workspace-switcher:hover,
	.workspace-switcher:focus-visible,
	.setting-control:hover,
	.setting-control:focus-visible {
		background: #575757;
		outline: none;
	}

	.workspace-switcher {
		margin-left: auto;
		background: #4c4c4c;
		font-weight: 600;
	}

	.tool-settings {
		gap: 0.75ch;
		height: 2lh;
		padding: 0 1ch;
		background: #454545;
		box-shadow: inset 0 1px rgb(255 255 255 / 0.06);
	}

	.setting-control {
		display: inline-flex;
		align-items: center;
		gap: 0.75ch;
		height: 1.5lh;
		padding: 0 1ch;
		background: #373737;
		color: #ededed;
	}

	.setting-tool {
		background: #252525;
		font-weight: 600;
	}

	.setting-muted {
		color: #a9a9a9;
		cursor: default;
	}

	.setting-value strong,
	.setting-control strong {
		font-weight: 500;
		color: #fff;
	}

	.chevron,
	.setting-icon {
		color: #bdbdbd;
	}

	.setting-icon-only {
		width: 4.5ch;
		justify-content: center;
		padding: 0;
	}

	:global(.dockview-container .dv-groupview .blender-panel-menu) {
		min-width: 0;
	}
</style>
