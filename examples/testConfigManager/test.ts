import { LayerClasses } from '../../src/layers'
import { ConfigManager } from '../../src/private/config/ConfigManager'

let testIndex = 0
function test(name: string, f: () => void) {
	testIndex++
	setTimeout(() => {
		// console.time('^')
		console.group(name)
		f()
		console.groupEnd()
		// console.timeEnd('^')
	}, testIndex * 300)
}

function shouldThrow(f: () => void) {
	try {
		f()
		console.error('should throw, but did not')
	} catch (e: any) {
		console.log('throws as expected: \n\t', e.message)
	}
}

const CONFIG0 = {
	version: '0.0.1' as const,
	app: {},
	layers: [],
	stages: [],
	scenes: [],
}

const CONFIG1 = {
	version: '0.0.1' as const,
	app: {
		width: 1400,
		height: 700,
		fov: 20,
		antialias: 'msaa' as const,
		background: 'transparent',
		autoResize: false,
		pitchLimit: [0, Math.PI * 0.7],
		debug: true,
	},
	layers: [
		{
			name: 'helper grid',
			id: 'LOCAL_LAYER_0',
			class: 'GridLayer' as const,
			props: {
				width: 10000,
				height: 10000,
				lineWidth: 3,
				depthTest: false,
				depthWrite: false,
				renderOrder: -10000,
				color: '#004a75',
			},
		},
		{
			name: 'model',
			id: 'LOCAL_LAYER_1',
			class: 'ModelLayer' as const,
			props: {
				scale: 50,
				glb: '/assets/models/demo.glb',
				projectionDesc: 'desc0|MercatorProjection|right|meters|0,0,0',
			},
		},
	],
	stages: [
		{
			name: 'MainStage',
			id: 'LOCAL_STAGE_MAIN' as const,
			layers: [
				'LOCAL_LAYER_0' as const,
				'LOCAL_LAYER_1' as const,
				'LOCAL_LAYER_2' as const,
				'LOCAL_LAYER_3' as const,
			],
			projection: undefined,
		},
	],
	scenes: [
		{
			id: 'LOCAL_SCENE_DEFAULT' as const,
			name: 'DefaultScene',
			cameraStateCode: '1|-0.000500|0.001524|0.000000|1.06540|0.20000|18.66000',
			stage: 'LOCAL_STAGE_MAIN' as const,
			layers: ['*' as const /* 显示该stage的所有layer */],
		},
		{
			id: 'LOCAL_SCENE_2' as const,
			name: 'scene2',
			cameraStateCode: '1|0.000200|0.000943|0.000000|0.99540|-0.48000|19.27600',
			stage: 'LOCAL_STAGE_MAIN' as const,
			layers: ['LOCAL_LAYER_1' as const, 'LOCAL_LAYER_3' as const],
		},
	],
}

const m = new ConfigManager<typeof LayerClasses>()

{
	m.addEventListener('init', (e) => console.log('init', e))

	m.addEventListener('app:change', (e) => console.log('app:change', e))

	m.addEventListener('layer:add', (e) => console.log('layer:add', e))
	m.addEventListener('layer:remove', (e) => console.log('layer:remove', e))
	m.addEventListener('layer:change:name', (e) => console.log('layer:change:name', e))
	m.addEventListener('layer:change:props', (e) => console.log('layer:change:props', e))

	m.addEventListener('stage:add', (e) => console.log('stage:add', e))
	m.addEventListener('stage:remove', (e) => console.log('stage:remove', e))
	m.addEventListener('stage:change:name', (e) => console.log('stage:change:name', e))
	m.addEventListener('stage:change:layers', (e) => console.log('stage:change:layers', e))
	m.addEventListener('stage:change:projection', (e) => console.log('stage:change:projection', e))

	m.addEventListener('scene:add', (e) => console.log('scene:add', e))
	m.addEventListener('scene:remove', (e) => console.log('scene:remove', e))
	m.addEventListener('scene:change:name', (e) => console.log('scene:change:name', e))
	m.addEventListener('scene:change:cameraStateCode', (e) =>
		console.log('scene:change:cameraStateCode', e)
	)
	m.addEventListener('scene:change:stage', (e) => console.log('scene:change:stage', e))
	m.addEventListener('scene:change:layers', (e) => console.log('scene:change:layers', e))
}

// dirt check

test('0 => 1', () => {
	m.init(structuredClone(CONFIG0))
	m.setConfig(structuredClone(CONFIG1))
})

test('1 => 1', () => {
	m.init(structuredClone(CONFIG1))
	m.setConfig(structuredClone(CONFIG1))
})

test('1 => 0', () => {
	m.init(structuredClone(CONFIG1))
	m.setConfig(structuredClone(CONFIG0))
})

test('change layer id', () => {
	m.init(structuredClone(CONFIG1))
	const CONFIG2 = structuredClone(CONFIG1)
	CONFIG2.layers[1].id = '112233'
	m.setConfig(structuredClone(CONFIG2))
})

test('change layer name', () => {
	m.init(structuredClone(CONFIG1))
	const CONFIG2 = structuredClone(CONFIG1)
	CONFIG2.layers[1].name = '112233'
	m.setConfig(structuredClone(CONFIG2))
})

test('change layer prop', () => {
	m.init(structuredClone(CONFIG1))
	const CONFIG2 = structuredClone(CONFIG1)
	CONFIG2.layers[1].props['aaa'] = '112233'
	m.setConfig(structuredClone(CONFIG2))
})

test('add layer', () => {
	m.init(structuredClone(CONFIG1))
	const CONFIG2 = structuredClone(CONFIG1)
	CONFIG2.layers.push({ id: '123456', name: '123456', class: 'GridLayer', props: {} as any })
	m.setConfig(structuredClone(CONFIG2))
})

test('add layer twice', () => {
	m.init(structuredClone(CONFIG1))
	const CONFIG2 = structuredClone(CONFIG1)
	CONFIG2.layers.push({ id: '123456', name: '123456', class: 'GridLayer', props: {} as any })
	CONFIG2.layers.push({ id: '123456', name: '123456', class: 'GridLayer', props: {} as any })
	shouldThrow(() => {
		m.setConfig(structuredClone(CONFIG2))
	})
})

test('remove layer', () => {
	m.init(structuredClone(CONFIG1))
	const CONFIG2 = structuredClone(CONFIG1)
	CONFIG2.layers.pop()
	m.setConfig(structuredClone(CONFIG2))
})
