/**
 * Copyright (C) 2021 Alibaba Group Holding Limited
 * All rights reserved.
 */

import { MeshDataType } from '@gs.i/schema'
import { OptimizePass, GSIRefiner } from '@gs.i/utils-optimize'
import { HtmlView } from '@polaris.gl/view-html'
import { GSIView } from '@polaris.gl/view-gsi'
import {
	Polaris,
	PolarisProps,
	defaultProps as defaultPolarisProps,
	Renderer,
	Layer,
	OutputPickEvent,
	PickResult,
	EVENT_NAME,
	CoordV2,
} from '@polaris.gl/schema'
import { PointerControl, TouchControl } from 'camera-proxy'
import { isTouchDevice } from '@polaris.gl/utils'
import * as Projections from '@polaris.gl/projection'
import { STDLayer } from '@polaris.gl/layer-std'
import Hammer from 'hammerjs'
import { throttle } from './Utils'
import localForage from 'localforage'

type LocalForage = typeof localForage

export interface PolarisGSIProps extends PolarisProps {
	enablePicking?: boolean
	hoverThrottle?: number
}

export const DefaultPolarisGSIProps: PolarisGSIProps = {
	...defaultPolarisProps,
	enablePicking: true,
	hoverThrottle: 150,
}

export interface PolarisGSI extends Polaris {
	addOptimizePass(pass: OptimizePass): void
	addByProjection(layer: Layer, projectionType?: number, center?: number[]): void
}

export interface LayerPickEvent extends OutputPickEvent {
	layer: Layer
}

export class PolarisGSI extends Polaris implements PolarisGSI {
	props: PolarisGSIProps

	/**
	 * top view layer
	 */
	view: {
		html: HtmlView
		gsi: GSIView
	}

	/**
	 * Renderer
	 */
	renderer: Renderer

	/**
	 * Scene optimization passes (executed before rendering)
	 */
	optimizePasses: OptimizePass[]

	/**
	 * pointer 事件封装
	 */
	private hammer

	/**
	 * Projection容器Layers
	 */
	private _projLayerWrappers: { [name: string]: Layer }

	/**
	 * Container resize listener
	 */
	private _resizeListener: any

	/**
	 * localStorage
	 */
	private _localForage: LocalForage

	constructor(props: PolarisGSIProps) {
		const _props = {
			...DefaultPolarisGSIProps,
			...props,
		}

		super(_props)

		this.name = 'PolarisGSI'
		this.optimizePasses = []
		this.view = {
			html: new HtmlView(this),
			gsi: new GSIView(this),
		}

		/**
		 * init html / canvas
		 */
		const container = this.props.container as HTMLDivElement

		// render html view
		this.view.html.element
		this.view.html.element.style.position = 'relative'
		this.view.html.element.style.width = this.width + 'px'
		this.view.html.element.style.height = this.height + 'px'
		this.view.html.element.style.overflow = 'hidden'
		this.view.html.element.className = 'polaris-wrapper'
		container.appendChild(this.view.html.element)

		// pointer 事件
		this._initPointerEvents()

		// 相机控制事件
		if (this.props.cameraControl) {
			if (isTouchDevice) {
				this.cameraControl = new TouchControl({
					camera: this.cameraProxy,
					element: this.view.html.element as HTMLElement,
				})
			} else {
				this.cameraControl = new PointerControl({
					camera: this.cameraProxy,
					element: this.view.html.element as HTMLElement,
				})
			}
			this.cameraControl.scale = 1.0 / (this.ratio ?? 1.0)
		}

		// Add optimize passes
		this.addOptimizePass(
			new GSIRefiner({
				frustumCulling: this.props.frustumCulling,
			})
		)

		// OptimizePasses会对SceneTree做更改，需排在第一个以便影响后续的Pass获取正确的场景信息
		const optimizeParams = {
			cameraPosition: {
				x: this.cameraProxy.position[0] - this.cameraProxy.center[0],
				y: this.cameraProxy.position[1] - this.cameraProxy.center[1],
				z: this.cameraProxy.position[2] - this.cameraProxy.center[2],
			},
			cameraRotation: {
				x: this.cameraProxy.rotationEuler[0],
				y: this.cameraProxy.rotationEuler[1],
				z: this.cameraProxy.rotationEuler[2],
			},
			cameraNear: this.props.cameraNear,
			cameraAspect: this.cameraProxy.aspect,
			cameraFOV: this.cameraProxy.fov,
			cameraFar: this.props.cameraFar,
		}
		this.onBeforeRender = () => {
			optimizeParams.cameraPosition.x = this.cameraProxy.position[0] - this.cameraProxy.center[0]
			optimizeParams.cameraPosition.y = this.cameraProxy.position[1] - this.cameraProxy.center[1]
			optimizeParams.cameraPosition.z = this.cameraProxy.position[2] - this.cameraProxy.center[2]
			optimizeParams.cameraRotation.x = this.cameraProxy.rotationEuler[0]
			optimizeParams.cameraRotation.y = this.cameraProxy.rotationEuler[1]
			optimizeParams.cameraRotation.z = this.cameraProxy.rotationEuler[2]
			optimizeParams.cameraNear = this.props.cameraNear
			optimizeParams.cameraAspect = this.cameraProxy.aspect
			optimizeParams.cameraFOV = this.cameraProxy.fov
			optimizeParams.cameraFar = this.props.cameraFar
			this.optimizePasses.forEach((pass) => pass.update(this.view.gsi.groupWrapper, optimizeParams))
		}

		/**
		 * Props listener
		 */

		// Renderer props update listener
		const rendererProps = [
			'background',
			'cameraNear',
			'cameraFar',
			'fov',
			'viewOffset',
			'lights',
			'postprocessing',
		]
		this.listenProps(rendererProps, () => {
			const newProps = {}
			for (let i = 0; i < rendererProps.length; i++) {
				const key = rendererProps[i]
				newProps[key] = this.getProps(key)
			}
			if (this.renderer) {
				this.cameraProxy.fov = newProps['fov']
				this.renderer.updateProps(newProps)
			}
		})

		// Responsive for container resize
		this.listenProps(['autoResize'], () => {
			const autoResize = this.getProps('autoResize')
			if (autoResize) {
				if (!this._resizeListener) {
					this._resizeListener = setInterval(() => {
						const width = container.clientWidth
						const height = container.clientHeight
						if (width !== this.width || height !== this.height) {
							this.resize(width, height, this.ratio, undefined)
							this.triggerEvent('viewChange', this.cameraProxy, this)
						}
					}, 200)
				}
			} else if (this._resizeListener) {
				clearInterval(this._resizeListener)
				this._resizeListener = undefined
			}
		})

		// Init indexedDB
		this._initLocalStorages()
	}

	getLocalStorage(type?: string): LocalForage {
		switch (type) {
			case 'localforage':
				return this._localForage
			default:
				return this._localForage
		}
	}

	addOptimizePass(pass: OptimizePass) {
		if (this.optimizePasses.indexOf(pass) > -1) {
			console.warn('PolarisGSI - You try to repeatedly add an optimize pass')
			this.optimizePasses.splice(this.optimizePasses.indexOf(pass), 1)
		}
		this.optimizePasses.push(pass)
	}

	setRenderer(renderer: Renderer) {
		if (this.renderer) {
			throw new Error('目前不支持动态替换 polaris 的 renderer')
		}

		this.renderer = renderer
		this.cameraProxy.config.onUpdate = (cam) => this.renderer.updateCamera(cam)
		this.cameraProxy['onUpdate'] = (cam) => this.renderer.updateCamera(cam)
		// 这里立刻update
		this.renderer.updateCamera(this.cameraProxy)
		this.renderer.resize(this.width, this.height, this.ratio)
		this.view.html.element.appendChild(this.renderer.canvas)
	}

	render() {
		if (!this.renderer) {
			throw new Error('Call .setRenderer() first. ')
		}
		// TODO 这里 不应该 允许 view 引用变化
		this.renderer.render(this.view.gsi)
	}

	capture() {
		if (!this.renderer) {
			throw new Error('Call .setRenderer() first. ')
		}
		this.tick()
		return this.renderer.capture()
	}

	/**
	 *
	 *
	 * @param {*} width
	 * @param {*} height
	 * @param {number} [ratio=1.0] 渲染像素比例，设置该值可渲染更低/更高分辨率图像
	 * @param {number} [externalScale=1.0] 外部设置的scale值，如style.transform等
	 * @memberof Polaris
	 */
	resize(width, height, ratio = 1.0, externalScale) {
		if (externalScale !== undefined) {
			console.warn('Please use Polaris.setScale(scale) api. ')
		}

		super.resize(width, height, ratio, externalScale)

		this.view.html.element.style.width = this.width + 'px'
		this.view.html.element.style.height = this.height + 'px'

		if (this.renderer) {
			this.renderer.resize(width, height, ratio)
			this.renderer.updateCamera(this.cameraProxy)
		}

		this.traverse((obj) => {
			obj._onViewChange.forEach((f) => f(this.cameraProxy, this))
		})
	}

	/**
	 * 通过世界坐标获取屏幕像素坐标
	 * 以container的左上角为(0, 0)
	 * @backward_compatibility
	 * @param {number} x
	 * @param {number} y
	 * @param {number} z
	 * @return {*}  {number[]}
	 * @memberof PolarisGSI
	 */
	getScreenXY(x: number, y: number, z: number): number[] | undefined {
		const deviceCoords = this.renderer.getNDC({ x, y, z }, this.cameraProxy)

		for (let i = 0; i < deviceCoords.length; i++) {
			const item = deviceCoords[i]
			if (isNaN(item)) {
				return
			}
		}

		// Map to canvas coords
		return [
			Math.round((deviceCoords[0] + 1) * 0.5 * this.width),
			Math.round((deviceCoords[1] + 1) * 0.5 * this.height),
		]
	}

	/**
	 * 根据projection类型添加layer至相应layerWrapper中
	 *
	 * @param {Layer} layer
	 * @param {number} projectionType 0 - MercatorProjection | 1 - SphereProjection | 2 - EquirectangularProjectionPDC
	 * @param {[number, number]} center
	 * @memberof PolarisGSI
	 */
	addByProjection(layer: Layer, projectionType = 0, center: number[] = [0, 0]) {
		let projName
		switch (projectionType) {
			case 0:
				projName = 'MercatorProjection'
				break
			case 1:
				projName = 'SphereProjection'
				break
			case 2:
				projName = 'EquirectangularProjectionPDC'
				break
			case 3:
				projName = 'EquirectangularProjection'
				break
			case 4:
				projName = 'AzimuthalEquidistantProjection'
				break
			case 5:
				projName = 'GallStereoGraphicProjection'
				break
			default:
				throw new Error(`Polaris - Invalid projectionType: ${projectionType}`)
		}

		if (Projections[projName] === undefined) {
			throw new Error(`Polaris - Invalid projectionType: ${projectionType}`)
		}

		if (!this._projLayerWrappers) {
			this._projLayerWrappers = {}
		}

		const wrapperName = projName + '|' + center.toString()

		if (this._projLayerWrappers[wrapperName] === undefined) {
			this._projLayerWrappers[wrapperName] = new STDLayer({
				parent: this,
				projection: new Projections[projName]({
					center,
				}),
			})
			this._projLayerWrappers[wrapperName].name = `Wrapper-${wrapperName}`
		}
		const wrapper = this._projLayerWrappers[wrapperName]
		wrapper.add(layer)
	}

	/**
	 * 射线命中测试
	 *
	 * @param {MeshDataType} object
	 * @param {{ x: number; y: number }} ndcCoords
	 * @param {{ allInters?: boolean; threshold?: number; backfaceCulling?: boolean }} options allInters: 是否返回所有碰撞点并排序; threshold: lineMesh碰撞测试阈值; backfaceCulling: triangleMesh是否测试背面
	 * @return {*}  {PickResult}
	 * @memberof PolarisGSI
	 */
	pick(
		object: MeshDataType,
		ndcCoords: { x: number; y: number },
		options?: { allInters?: boolean; threshold?: number; backfaceCulling?: boolean }
	): PickResult {
		if (!this.renderer) {
			console.error('Call .setRenderer() first. ')
			return {
				hit: false,
			}
		}
		if (this.renderer.pick === undefined) {
			console.error('Renderer has no pick method implemented')
			return {
				hit: false,
			}
		}
		return this.renderer.pick(object, ndcCoords, options)
	}

	dispose() {
		this.cameraProxy.config.onUpdate = () => {}
		this.cameraProxy['onUpdate'] = () => {}

		if (this.renderer) {
			this.renderer.dispose()
		}

		// Remove event listeners
		this.hammer.off('tap')
		this.hammer.destroy()
		const element = this.view.html.element as HTMLElement
		element.removeEventListener('mousemove', this._mouseMoveHanlder)

		// Dispose layers
		this.traverse((base) => {
			base !== this && base.dispose && base.dispose()
		})

		this.children.forEach((child) => {
			this.remove(child)
		})

		if (this.view.html.element.parentElement) {
			this.view.html.element.parentElement.removeChild(this.view.html.element)
		}

		super.dispose()
	}

	/**
	 * 初始化pointer相关事件
	 *
	 * @private
	 * @memberof PolarisGSI
	 */
	private _initPointerEvents() {
		if (this.props.enablePointer) {
			const element = this.view.html.element as HTMLElement
			element.addEventListener('contextmenu', (e) => {
				e.preventDefault()
			})

			// Pointer event registration
			this.hammer = new Hammer.Manager(element)
			const tap = new Hammer.Tap({
				event: 'tap',
				pointers: 1,
				taps: 1,
			})
			this.hammer.add(tap)
			this.hammer.on('tap', (e) => {
				if (this.getProps('enablePicking')) {
					const center = e.center
					this._handlePointerEvent('_onClick', center, 'picked')
				}
			})

			// Use flag & timer to prevent [touchend, mousemove] linked events triggering
			let isTouched = false
			let lastTouchedTime = 0
			element.addEventListener('touchstart', () => (isTouched = true))
			element.addEventListener('touchend', () => {
				isTouched = false
				lastTouchedTime = this.timeline.currentTime
			})

			//
			let isMouseDown = false
			element.addEventListener('mousedown', () => (isMouseDown = true))
			element.addEventListener('mouseup', () => (isMouseDown = false))

			//
			let viewChangeTime = this.timeline.currentTime
			this.onViewChange = () => {
				viewChangeTime = this.timeline.currentTime
			}

			// Event callback throttling
			this._mouseMoveHanlder = throttle(
				this.timeline.frametime,
				(e) => {
					// Disable hover when:
					// 1. device has been touched
					// 2. mouse has been pressed
					// 3. camera has been stable for x frames
					// 4. lastTouchedTime has passed for x ms
					if (
						this.getProps('enablePicking') &&
						isTouched === false &&
						isMouseDown === false &&
						this.timeline.currentTime - viewChangeTime > this.timeline.frametime * 2 &&
						this.timeline.currentTime - lastTouchedTime > 500 // TODO: remove hardcoding
					) {
						const center = { x: e.x, y: e.y }
						this._handlePointerEvent('_onHover', center, 'hovered')
					}
				},
				this
			)
			element.addEventListener('mousemove', this._mouseMoveHanlder)
		}
	}

	private _mouseMoveHanlder: (e: any) => void

	private _handlePointerEvent(eventName: string, pxCoords: any, eventCallback: EVENT_NAME) {
		const element = this.view.html.element as HTMLElement
		const bbox = element.getBoundingClientRect()
		const left = bbox.left
		const top = bbox.top
		const width = element.clientWidth
		const height = element.clientHeight
		const canvasCoords = { x: pxCoords.x - left, y: pxCoords.y - top }
		const ndc = {
			x: ((pxCoords.x - left) / width) * 2 - 1,
			y: -((pxCoords.y - top) / height) * 2 + 1,
		}
		if (ndc.x < -1.0 || ndc.x > 1.0 || ndc.y < -1.0 || ndc.y > 1.0) {
			return
		}
		// Collect pick results
		const candidates: LayerPickEvent[] = []
		this.traverseVisible((obj) => {
			const layer = obj as Layer
			if (layer.isLayer && layer.getProps('pickable') && layer[eventName]) {
				const layerRes = layer[eventName](this, canvasCoords, ndc) as OutputPickEvent
				if (layerRes) {
					// Layer was picked, add to candidates list
					candidates.push({
						...layerRes,
						layer: layer,
						// pointer coords
						pointerCoords: {
							screen: pxCoords,
							canvas: canvasCoords,
							ndc: ndc,
						},
					})
				} else {
					// Callback with no params
					layer.triggerEvent(eventCallback)
				}
			}
		})
		// Sort and get the closest picked layer
		if (candidates.length > 0) {
			candidates.sort(this._pickedLayerSortFn)
			for (let i = 0; i < candidates.length; i++) {
				const result = candidates[i]
				if (i === 0) {
					result.layer.triggerEvent(eventCallback, result)
				} else {
					result.layer.triggerEvent(eventCallback)
				}
			}
		}
	}

	/**
	 * 处理picking事件排序
	 *
	 * @protected
	 * @param {LayerPickEvent} a
	 * @param {LayerPickEvent} b
	 * @return {*}  {number}
	 * @memberof PolarisGSI
	 */
	protected _pickedLayerSortFn(a: LayerPickEvent, b: LayerPickEvent): number {
		const meshA = a.object
		const meshB = b.object
		if (meshA !== undefined && meshB !== undefined) {
			if (meshA.material !== undefined && meshB.material !== undefined) {
				// 1. Compare depthTest
				// if both are true, compare distance
				if (meshA.material.depthTest !== undefined && meshB.material.depthTest !== undefined) {
					if (meshA.material.depthTest === true && meshB.material.depthTest === true) {
						return a.distance - b.distance
					}
				}
				// 2. Compare transparent
				// transparent object is always rendered after non-transparent object
				else if (
					meshA.material['transparent'] === true &&
					meshB.material['transparent'] === false
				) {
					return 1
				} else if (
					meshA.material['transparent'] === false &&
					meshB.material['transparent'] === true
				) {
					return -1
				}
			}
			// 3. Compare renderOrder
			// lower renderOrder => earlier to render => covered by larger renderOrder
			else if (
				meshA.renderOrder !== undefined &&
				meshB.renderOrder !== undefined &&
				meshA.renderOrder !== meshB.renderOrder
			) {
				return meshB.renderOrder - meshA.renderOrder
			}
		}
		return a.distance - b.distance
	}

	private _initLocalStorages() {
		localForage.config({
			driver: localForage.INDEXEDDB,
			name: 'PolarisGSI_LocalDB',
			version: 1.0,
			// storeName: 'keyvaluepairs',
			description: 'PolarisGSI_LocalDB',
		})
		this._localForage = localForage
	}
}