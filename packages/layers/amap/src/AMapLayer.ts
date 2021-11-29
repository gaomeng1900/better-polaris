/**
 * Copyright (C) 2021 Alibaba Group Holding Limited
 * All rights reserved.
 */

import { STDLayer, STDLayerProps } from '@polaris.gl/layer-std'
declare let window: any

export interface AMapLayerProps extends STDLayerProps {
	key: string
	renderOrder: number
	showLogo: boolean
	zooms: [number, number]
	style: string
	layers: { name: string; show: boolean }[]
	features: { name: string; show: boolean }[]
}

export const defaultProps: AMapLayerProps = {
	key: 'f8d835e1abdb0e4355b19aa454f4de65', // 高德API使用key,可以缺省
	// key: '550dbc967967e5a778337699e04435fa',
	renderOrder: -999,
	showLogo: true, // 是否显示高德logo
	zooms: [3, 20], // 地图缩放上下限,默认3~20
	style: 'normal', // //主题有: 标准-normal, 幻影黑-dark,月光银-light,远山黛-whitesmoke,草色青-fresh,雅土灰-grey,涂鸦-graffiti,马卡龙-macaron,靛青蓝-blue,极夜蓝-darkblue,酱籽-wine
	layers: [
		// 地图显示图层集合: 卫星图层-Satellite,路网图层RoadNet,实施交通图层-Traffic
		{ name: 'Satellite', show: false },
		{ name: 'RoadNet', show: false },
		{ name: 'Traffic', show: false },
	],
	features: [
		// 地图显示要素集合: 区域面-bg,兴趣点-point,道路及道路标注-road,建筑物-building
		{ name: 'bg', show: true },
		{ name: 'point', show: false },
		{ name: 'road', show: true },
		{ name: 'building', show: false },
	],
}

export class AMapLayer extends STDLayer {
	projection
	cam
	map
	isWarning = false //高德参数是否正常
	AMap
	key

	constructor(props: Partial<AMapLayerProps> = {}) {
		super(props)
		props = {
			...defaultProps,
			...props,
		}
		this.setProps(props)

		this.name = this.group.name = 'AMapLayer'
		this.element.className = 'polaris-amap-layer'
		this.element.id = 'polaris-amap-layer'
	}

	init = (projection, timeline, polaris) => {
		// polaris图层背景透明
		this.polaris = polaris
		this.polaris['renderer'].renderer.setClearAlpha(0.0)
		// 获取相机和投影
		this.cam = polaris.cameraProxy
		this.projection = projection

		// amap属性监听
		this.listenProps(['key', 'renderOrder', 'showLogo', 'style', 'layers', 'features'], () => {
			const key = this.getProps('key')
			if (!window.AMap || this.key !== key) {
				this.key = key
				this._loadJSAPI(key, () => {
					this._initAMap(window.AMap)
					this._initAmapCamera(polaris)
					this.onViewChange = this._synchronizeCameras
					// 更新地图
					this._updateAMap(window.AMap)
				})
			} else {
				this._updateAMap(window.AMap)
			}
		})
	}

	/**
	 * 异步加载高德JS
	 * @param {*} key 高德API秘钥
	 */
	_loadJSAPI = (key: string, callback: any) => {
		window.onLoad = () => {
			console.log('AMap script loaded')
			if (window.AMap) {
				callback()
			} else {
				console.warn(`高德JSAPI未能成功加载，请检查key是否正确!`)
			}
		}
		const url = 'https://webapi.amap.com/maps?v=1.4.15&key=' + key + '&callback=onLoad'
		// const url = 'https://webapi.amap.com/maps?v=2.0&key=' + key + '&callback=onLoad'
		const jsapi = document.createElement('script')
		jsapi.charset = 'utf-8'
		jsapi.src = url
		document.body.appendChild(jsapi)
	}

	/**
	 * 初始化高德图层
	 * @param {*} AMap 高德API
	 */
	_initAMap = (AMap: any) => {
		// Amap图层必须在最底层
		const parentElement = this.element.parentElement
		if (parentElement) {
			parentElement.removeChild(this.element)
			if (parentElement.hasChildNodes()) {
				parentElement.insertBefore(this.element, parentElement.firstChild)
			} else {
				parentElement.appendChild(this.element)
			}
		}
		const polarisElement = document.getElementsByClassName('polaris-wrapper')[0]
		if (parentElement) {
			parentElement.style.height = polarisElement['style'].height
			parentElement.style.width = polarisElement['style'].width
			this.element.style.height = parentElement['style'].height
			this.element.style.width = parentElement['style'].width
		}

		this.element.style.position = 'absolute'
		this.element.style.zIndex = '-9999'

		if (AMap !== undefined) {
			this.map = new AMap.Map(this.element, {
				// 默认属性
				viewMode: '3D',
				animateEnable: false, // 为了相机同步，禁止缓动效果
				jogEnable: false, // 为了相机同步，禁止动画效果
				buildingAnimation: false, // 禁止楼快出现动画效果
				resizeEnable: true,
				expandZoomRange: true, // zooms默认最大为19，true才能放大至20
				zooms: [3, 20], // 高德默认[3,19]
				zoomEnable: true,
				// 自定义属性
				center: [120, 30],
				zoom: 8,
				mapStyle: 'amap://styles/normal',
				layers: [],
				features: ['bg', 'road'],
				// 区别投影
				crs: this.projection.type === 'MercatorProjection' ? 'EPSG3857' : 'EPSG4326',
			})
		}
	}

	/**
	 * 设置高德图层的参数
	 */
	_updateAMap = (AMap) => {
		// 图层顺序
		const renderOrder = this.getProps('renderOrder')
		if (this.element) {
			this.element.style.zIndex = renderOrder
		}
		const style = this.getProps('style')
		const layers = this.getProps('layers')
		const features = this.getProps('features')
		if (AMap !== undefined) {
			// 改变样式
			this.map.setMapStyle('amap://styles/' + style)
			// 添加图层
			const layerArr = [new AMap.TileLayer({})]
			if (layers) {
				for (let i = 0; i < layers.length; i++) {
					if (layers[i].show) {
						const newLayer = new AMap.TileLayer[layers[i].name]({})
						layerArr.push(newLayer)
					}
				}
			}
			this.map.setLayers(layerArr)
			// 添加要素
			const featuresArr = new Array<string>()
			if (features) {
				for (let i = 0; i < features.length; i++) {
					if (features[i].show) {
						featuresArr.push(features[i].name)
					}
				}
			}
			this.map.setFeatures(featuresArr)

			// 是否显示高德logo和copyright
			const showLogo = this.getProps('showLogo')
			const logoElement = document.getElementsByClassName('amap-logo')[0]
			const colpyRightElement = document.getElementsByClassName('amap-copyright')[0]
			if (!showLogo && logoElement && colpyRightElement) {
				logoElement['style'].visibility = 'hidden'
				colpyRightElement['style'].opacity = 0
			} else {
				logoElement['style'].visibility = 'inherit'
				colpyRightElement['style'].opacity = 1
			}
		}
	}

	/**
	 * 立即同步相机
	 */
	_initAmapCamera = (polaris: any) => {
		if (this.map) {
			const cam = polaris.cameraProxy
			// 限制polaris的zoom范围与高德对应
			const zooms = this.getProps('zooms')
			const zoomMin = zooms[0]
			const zoomMax = zooms[1]
			if (cam.zoom <= zoomMin) {
				cam.setZoom(zoomMin)
			}
			if (cam.zoom >= zoomMax) {
				cam.setZoom(zoomMax)
			}
			// 更新polaris视角
			const param = zoomToPerspectiveParam(cam.zoom, cam.canvasWidth, cam.canvasHeight)
			const newFov = (param.fov / Math.PI) * 180.0

			polaris.renderer.updateProps({ fov: newFov })
			cam.fov = newFov
			cam.update()

			// 稍微改变经纬度触发同步
			const amapCenter = this.projection.unproject(...cam.center)
			const { pitch, rotation, zoom } = cam
			const statesCode =
				'1|' +
				(amapCenter[0] + 0.000001).toFixed(6) +
				'|' +
				amapCenter[1].toFixed(6) +
				'|0.000000|' +
				pitch.toFixed(5) +
				'|' +
				rotation.toFixed(5) +
				'|' +
				zoom.toFixed(5)
			polaris.setStatesCode(statesCode)
		}
	}

	/**
	 * 相机同步（暂时是polaris操作高德,实现基本视角控制）
	 */
	_synchronizeCameras = (cam, polaris) => {
		if (this.map !== undefined) {
			// 限制polaris的zoom范围与高德对应
			const zooms = this.getProps('zooms')
			const zoomMin = zooms[0]
			const zoomMax = zooms[1]
			if (cam.zoom <= zoomMin) {
				cam.setZoom(zoomMin)
			}
			if (cam.zoom >= zoomMax) {
				cam.setZoom(zoomMax)
			}
			// 更新polaris视角
			const { zoom, pitch, rotation, center, canvasWidth, canvasHeight } = cam
			const param = zoomToPerspectiveParam(zoom, canvasWidth, canvasHeight)
			const newFov = (param.fov / Math.PI) * 180.0

			if (cam.fov !== newFov) {
				polaris.renderer.updateProps({ fov: newFov })
				cam.fov = newFov
				cam.update()
			}

			// 同步高德相机
			const amapPitch = (pitch / Math.PI) * 180.0
			const amapRotation = (rotation / Math.PI) * 180.0
			const amapCenter = this.projection.unproject(...center)
			this.map.setZoom(zoom)
			this.map.setCenter([amapCenter[0], amapCenter[1]])
			this.map.setPitch(amapPitch)
			this.map.setRotation(amapRotation)

			/**
			 * 高德autoResize
			 */
			if (
				this.map.getContainer().clientWidth !== canvasWidth ||
				this.map.getContainer().clientHeight !== canvasHeight
			) {
				this.map.getContainer().style.width = canvasWidth + 'px'
				this.map.getContainer().style.height = canvasHeight + 'px'
				this.map.resize && this.map.resize()
			}

			// 检测高德地图是否有跟随polaris变化
			const newZoom = this.map.getZoom()
			const newCenter = this.map.getCenter()
			const newPitch = this.map.getPitch()
			if (
				!equal(zoom, newZoom) ||
				!equal(amapCenter[0], newCenter.lng) ||
				!equal(amapCenter[1], newCenter.lat) ||
				!equal(amapPitch, newPitch)
			) {
				this.hide()
				if (!this.isWarning) {
					console.warn('高德地图不支持当前参数, 隐藏')
					this.isWarning = true
					setTimeout(() => {
						this.isWarning = false
					}, 5000)
				}
			} else {
				this.show()
			}
		}
	}
}

const equal = (a: number, b: number, threshold = 0.001) => {
	return Math.abs(a - b) < threshold
}

/**
 * 高德地图相机 fov 根据 zoom 变化而变化，Polaris 需要不断适应新的 fov
 * @param {*} zoom //3~20
 * @param {*} canvasW
 * @param {*} canvasH
 */
const zoomToPerspectiveParam = (zoom: number, canvasW: number, canvasH: number) => {
	const aspect = canvasW / canvasH
	const temp = (canvasH / 2) * Math.pow(2, 20 - zoom)
	let fov = ((56 - zoom) * Math.PI) / 180
	let height = temp / Math.tan(fov / 2)
	if (height < 2400) {
		height = 2400
		fov = 2 * Math.atan(temp / height)
	}

	const near = height / 10
	const far = height * 50

	return {
		fov,
		aspect,
		near,
		far,
		height,
	}
}