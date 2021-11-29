/**
 * Copyright (C) 2021 Alibaba Group Holding Limited
 * All rights reserved.
 */

import { computeBBox, computeBSphere } from '@gs.i/utils-geometry'
/**
 * 基类。
 * 可以使用 Layer，自己添加需要的 view；
 * 也可以使用 STDLayer，添加好 threeView 和 htmlView 的 Layer，懒人福音。
 */
import { STDLayer, STDLayerProps } from '@polaris.gl/layer-std'
import { Mesh, Geom, Attr, MatrPbr } from '@gs.i/frontend-sdk'
import { Color } from '@gs.i/utils-math'
import { getGeom, getCoords } from '@turf/invariant'
import polygonToLine from '@turf/polygon-to-line'
import { LineIndicator } from '@polaris.gl/utils-indicator'

/**
 * 内部逻辑依赖
 */
import { FeatureCollection } from '@turf/helpers'
import {
	triangulateGeoJSON,
	CDTGeojsonWithSubdivision,
	getColorUint,
	getFeatureStringKey,
} from '../utils'
import { PolygonMatr } from './PolygonMatr'
import { Polaris } from '@polaris.gl/schema'
import { isDISPOSED } from '@gs.i/schema'
import { WorkerManager } from '@polaris.gl/utils-worker-manager'
import GeomWorker from 'worker-loader!../workers/PolygonGeom'

/**
 * 配置项 interface
 */
export interface PolygonSurfaceLayerProps extends STDLayerProps {
	/**
	 * Data
	 */
	data?: FeatureCollection
	/**
	 * Style related
	 */
	useTessellation?: boolean
	tessellation?: number
	getColor?: any
	getOpacity?: any
	getThickness?: any
	baseAlt?: number
	transparent?: boolean
	doubleSide?: boolean
	metallic?: number
	roughness?: number
	/**
	 * Selection relatec
	 */
	genSelectLines?: boolean
	selectLinesHeight?: number
	hoverLineLevel?: 1 | 2 | 4
	hoverLineWidth?: number
	hoverLineColor?: any
	selectLineLevel?: 1 | 2 | 4
	selectLineWidth?: number
	selectLineColor?: any
	/**
	 * Local storage/cache related
	 */
	// storeGeomToLocalDB?: boolean
	// clearStorage?: boolean
	maxMemCacheCount?: number
	featureStorageKey?: string
	/**
	 * Worker params
	 */
	workersCount?: number
}

/**
 * 配置项 默认值
 */
const defaultProps: PolygonSurfaceLayerProps = {
	useTessellation: false,
	tessellation: 3,
	getColor: '#689826',
	getOpacity: 1,
	getThickness: 0,
	baseAlt: 0,
	transparent: false,
	doubleSide: false,
	metallic: 0.1,
	roughness: 1.0,
	genSelectLines: false,
	selectLinesHeight: 0,
	hoverLineLevel: 2,
	hoverLineWidth: 1,
	hoverLineColor: '#262626',
	selectLineLevel: 2,
	selectLineWidth: 2,
	selectLineColor: '#FFAE0F',
	// storeGeomToLocalDB: true,
	// clearStorage: false,
	maxMemCacheCount: 0,
	featureStorageKey: 'properties.adcode',
	workersCount: 0,
}

/**
 * 类
 */
export class PolygonSurfaceLayer extends STDLayer {
	props: any
	geom: Geom
	matr: MatrPbr
	mesh: Mesh

	/**
	 * Select/Hover objects
	 */
	hoverIndicator: LineIndicator
	selectIndicator: LineIndicator
	// 记录Polygon中feature的Index range
	featIndexRangeMap: Map<any, Uint32Array>
	// 记录Polygon中feature的Color attr range
	featColorRangeMap: Map<any, Uint32Array>
	// 记录feature的ColorUint信息
	featColorMap: Map<any, Uint32Array>
	// 记录LineIndicator中feature的偏移信息
	featLineInfoMap: Map<any, { offset: number; count: number }[]>

	/**
	 * Worker Manager
	 */
	private _workerManager: WorkerManager

	/**
	 * Mem cache
	 */
	private _geomCache: Map<string, GeomCacheType>

	/**
	 * IndexedDB store name
	 */
	private _storeName: string

	// private _dbInstance: LocalForage

	private _tessellation: number

	constructor(props: PolygonSurfaceLayerProps = {}) {
		const _props = {
			...defaultProps,
			...props,
		}
		super(_props)
		this.props = _props

		// Local caches
		this._storeName = 'Polaris_PolygonSurfaceLayer'
		this._geomCache = new Map()

		this.listenProps(['tessellation'], () => {
			this._tessellation = this.getProps('tessellation') ?? 0
		})

		this.matr = new PolygonMatr()

		this.listenProps(['transparent', 'doubleSide', 'metallic', 'roughness'], () => {
			this.matr.metallicFactor = this.getProps('metallic')
			this.matr.roughnessFactor = this.getProps('roughness')
			this.matr.alphaMode = this.getProps('transparent') ? 'BLEND' : 'OPAQUE'
			this.matr.side = this.getProps('doubleSide') ? 'double' : 'front'
		})

		this.onRenderOrderChange = (renderOrder) => {
			if (this.mesh) {
				this.mesh.renderOrder = renderOrder
			}
			if (this.selectIndicator) {
				this.selectIndicator.gline.renderOrder = renderOrder
			}
			if (this.hoverIndicator) {
				this.hoverIndicator.gline.renderOrder = renderOrder
			}
		}

		this.onViewChange = (cam, polaris) => {
			if (this.selectIndicator) {
				const p = polaris as Polaris
				this.selectIndicator.updateResolution(p.canvasWidth, p.canvasHeight)
			}
			if (this.hoverIndicator) {
				const p = polaris as Polaris
				this.hoverIndicator.updateResolution(p.canvasWidth, p.canvasHeight)
			}
		}
	}

	init(projection, timeline, polaris) {
		// Init WorkerManager
		this.listenProps(['workersCount'], () => {
			const count = this.getProps('workersCount')
			if (count > 0) {
				const workers: Worker[] = []
				for (let i = 0; i < count; i++) {
					workers.push(new GeomWorker())
				}
				this._workerManager = new WorkerManager(workers)
			}
		})

		// 3D 内容
		this.mesh = new Mesh({ name: 'PolygonSurface', material: this.matr })
		this.group.add(this.mesh)

		// Local indexeddb
		// this.listenProps(['clearStorage'], () => {
		// 	if (this.getProps('clearStorage')) {
		// 		const localForage = p.getLocalStorage()
		// 		localForage.clear().catch((err) => {
		// 			if (err) console.error(`Polaris::PolygonSurfaceLayer - Clear local DB failed, ${err}`)
		// 		})
		// 		// Reset flag
		// 		this.updateProps({
		// 			clearStorage: false,
		// 		})
		// 	}
		// })

		// 数据与配置的应用（包括reaction）
		this.listenProps(
			[
				'data',
				'getThickness',
				'getColor',
				'getOpacity',
				'baseAlt',
				'useTessellation',
				'genSelectLines',
				'selectLinesHeight',
				'selectLineWidth',
				'selectLineLevel',
				'selectLineColor',
			],
			async (e) => {
				const data = this.getProps('data')
				if (!(data && Array.isArray(data.features))) {
					return
				}
				const cached = this._getCachedGeom(data.features)
				if (cached) {
					this.mesh.geometry = cached.geom
					if (this.getProps('genSelectLines')) {
						this.selectIndicator = cached.selectIndicator
						this.hoverIndicator = cached.hoverIndicator
						this.selectIndicator.addToLayer(this)
						this.hoverIndicator.addToLayer(this)
					}
				} else {
					await this.createGeom(data, projection, polaris)
				}
			}
		)
	}

	private async createGeom(data, projection, polaris) {
		this.featIndexRangeMap = new Map()
		this.featColorRangeMap = new Map()
		this.featLineInfoMap = new Map()
		this.featColorMap = new Map()

		const getThickness = this.getProps('getThickness')
		const getColor = this.getProps('getColor')
		const getOpacity = this.getProps('getOpacity')
		const baseAlt = this.getProps('baseAlt')
		const genSelectLines = this.getProps('genSelectLines')

		const positions: number[] = []
		const colors: number[] = []
		const indices: number[] = []
		const linePosArr: number[][] = []
		let linePosOffset = 0
		let offset = 0

		let results
		if (this._workerManager) {
			// Triangulate geojson using workers
			const geomPendings: Promise<any>[] = []
			data.features.forEach((feature, index) => {
				feature.index = index // Store feature index range
				let promise
				if (this.getProps('useTessellation') && !projection.isPlaneProjection) {
					promise = this._workerManager.execute({
						data: {
							task: 'tessellation',
							feature,
							tessellation: this._tessellation,
						},
						transferables: undefined,
					})
				} else {
					promise = this._workerManager.execute({
						data: {
							task: 'triangulate',
							feature,
						},
						transferables: undefined,
					})
				}
				geomPendings.push(promise)
			})
			results = await Promise.all(geomPendings)
		} else {
			// Triangulate geojson in main thread
			results = []
			data.features.forEach((feature, index) => {
				feature.index = index // Store feature index range
				let result
				if (this.getProps('useTessellation') && !projection.isPlaneProjection) {
					result = CDTGeojsonWithSubdivision(feature, Math.pow(2, this._tessellation))
				} else {
					result = triangulateGeoJSON(feature)
				}
				result.index = index
				results.push(result)
			})
		}

		results.forEach((result) => {
			const feature = data.features[result.index]
			const points = result.points
			const triangles = result.triangles

			const indexRange = new Uint32Array([indices.length, 0])
			const colorRange = new Uint32Array([offset * 4, 0])

			for (let i = 0; i < points.length; i += 2) {
				const xyz = projection.project(points[i], points[i + 1], baseAlt + getThickness(feature))
				positions.push(...xyz)
			}
			for (let i = 0; i < triangles.length; i++) {
				indices.push(triangles[i] + offset)
			}

			const count = points.length / 2
			const offset4 = offset * 4
			const color = new Color(getColor(feature))
			const alpha = getOpacity(feature) ?? 1.0
			const colorUint = getColorUint(color, alpha)
			for (let i = 0; i < count; i++) {
				const i4 = i * 4
				colors[i4 + 0 + offset4] = colorUint[0]
				colors[i4 + 1 + offset4] = colorUint[1]
				colors[i4 + 2 + offset4] = colorUint[2]
				colors[i4 + 3 + offset4] = colorUint[3]
			}
			this.featColorMap.set(feature, colorUint)

			offset += count

			// Store index range for feature
			indexRange[1] = indices.length - 1
			// Store feature vert range
			colorRange[1] = offset * 4

			this.featIndexRangeMap.set(feature, indexRange)
			this.featColorRangeMap.set(feature, colorRange)

			// LineIndicator geom info creation
			if (genSelectLines) {
				const linePos = this._getLinePositions(feature, projection)
				if (linePos) {
					linePos.forEach((positions) => {
						linePosArr.push(positions)

						// Cache offset/count info
						const info = this.featLineInfoMap.get(feature)
						if (info) {
							info.push({
								offset: linePosOffset,
								count: positions.length / 3,
							})
						} else {
							this.featLineInfoMap.set(feature, [
								{
									offset: linePosOffset,
									count: positions.length / 3,
								},
							])
						}

						// Offset
						linePosOffset += positions.length / 3
					})
				}
			}
		})

		this.geom = new Geom()

		this.geom.attributes.position = new Attr(new Float32Array(positions), 3)
		this.geom.attributes.color = new Attr(new Uint16Array(colors), 4, false, 'DYNAMIC_DRAW')
		const indicesArray = offset > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)
		this.geom.indices = new Attr(indicesArray, 1)

		this.mesh.geometry = this.geom

		computeBSphere(this.geom)
		computeBBox(this.geom)

		// Create selection polyline
		// Remove if existed
		this._removeIndicator(this.selectIndicator)
		this._removeIndicator(this.hoverIndicator)
		if (genSelectLines) {
			this._genLineIndicators(polaris, linePosArr)
		}
	}

	private _genLineIndicators(polaris, selectPosArr: number[][]) {
		// Hover indicator
		const hoverLineWidth = this.getProps('hoverLineWidth') as number
		const hoverLineColor = this.getProps('hoverLineColor')
		const hoverLineLevel = this.getProps('hoverLineLevel')
		let hoverLevel = hoverLineLevel
		if (hoverLineWidth > 1 && hoverLineLevel === 1) {
			hoverLevel = 2
		}
		const hoverLineConfig = {
			level: hoverLevel,
			opacity: 1.0,
			lineWidth: hoverLineWidth,
			useColors: true,
			resolution: {
				x: polaris.canvasWidth ?? polaris.width,
				y: polaris.canvasHeight ?? polaris.height,
			},
			usePerspective: false,
			dynamic: true,
			u: false,
			texture: undefined,
			renderOrder: this.getProps('renderOrder'),
			depthTest: true,
			transparent: false,
			alphaTest: 0.0001,
		}
		const hoverIndicator = new LineIndicator(selectPosArr, hoverLineConfig, {
			defaultColor: new Color(0.0, 0.0, 0.0),
			defaultAlpha: 0.0,
			highlightColor: new Color(hoverLineColor),
			highlightAlpha: 1.0,
		})
		hoverIndicator.addToLayer(this)

		// Select indicator
		const selectLineWidth = this.getProps('selectLineWidth') as number
		const selectLineColor = this.getProps('selectLineColor')
		const selectLineLevel = this.getProps('selectLineLevel')
		let selectLevel = selectLineLevel
		if (selectLineWidth > 1 && selectLineLevel === 1) {
			selectLevel = 2
		}
		const selectLineConfig = {
			level: selectLevel,
			opacity: 1.0,
			lineWidth: selectLineWidth,
			useColors: true,
			resolution: {
				x: polaris.canvasWidth ?? polaris.width,
				y: polaris.canvasHeight ?? polaris.height,
			},
			usePerspective: false,
			dynamic: true,
			u: false,
			texture: undefined,
			renderOrder: this.getProps('renderOrder'),
			depthTest: true,
			transparent: false,
			alphaTest: 0.0001,
		}
		const selectIndicator = new LineIndicator(selectPosArr, selectLineConfig, {
			defaultColor: new Color(0.0, 0.0, 0.0),
			defaultAlpha: 0.0,
			highlightColor: new Color(selectLineColor),
			highlightAlpha: 1.0,
		})
		selectIndicator.addToLayer(this)

		this.selectIndicator = selectIndicator
		this.hoverIndicator = hoverIndicator
	}

	/**
	 * 获取feature的geometry index range
	 * @param feature
	 * @returns
	 */
	getFeatureIndexRange(feature) {
		return this.featIndexRangeMap.get(feature)
	}

	/**
	 * 获取feature的geometry color attribute range
	 * @param feature
	 * @returns
	 */
	getFeatureColorRange(feature) {
		return this.featColorRangeMap.get(feature)
	}

	/**
	 * 获取feature的line indicator信息，包含offset, count
	 * @param feature
	 * @returns
	 */
	getFeatureLineInfo(feature) {
		return this.featLineInfoMap.get(feature)
	}

	/**
	 * 获取feature的default color信息
	 * @param feature
	 * @returns
	 */
	getFeatureColor(feature) {
		return this.featColorMap.get(feature)
	}

	/**
	 * 更新feature polygon的填充色
	 * @param feature
	 * @param color
	 * @param alpha
	 */
	updateFeatureColor(feature: any, color: Color, alpha: number) {
		if (!this.geom) return

		const range = this.getFeatureColorRange(feature)
		if (!range) return

		const attr = this.geom.attributes.color
		if (!attr) return

		const array = this.geom.attributes.color.array
		if (isDISPOSED(array)) return

		let needsUpdate = false
		const colorUint = getColorUint(color, alpha)
		for (let i = range[0]; i < range[1]; i += 4) {
			if (
				array[i + 0] !== colorUint[0] ||
				array[i + 1] !== colorUint[1] ||
				array[i + 2] !== colorUint[2] ||
				array[i + 3] !== colorUint[3]
			) {
				array[i + 0] = colorUint[0]
				array[i + 1] = colorUint[1]
				array[i + 2] = colorUint[2]
				array[i + 3] = colorUint[3]
				needsUpdate = true
			}
		}

		if (needsUpdate) {
			attr.updateRanges = attr.updateRanges ?? []
			attr.updateRanges.push({
				start: range[0],
				count: range[1] - range[0],
			})
			attr.version++
		}
	}

	/**
	 * 恢复Polygon原始填充色
	 * @param feature
	 */
	restoreFeatureColor(feature: any) {
		if (!this.geom) return

		const attr = this.geom.attributes.color
		const array = this.geom.attributes.color.array
		if (isDISPOSED(array)) return

		const colorUint = this.getFeatureColor(feature)
		if (!colorUint) return

		const range = this.getFeatureColorRange(feature)
		if (!range) return

		let needsUpdate = false
		for (let i = range[0]; i < range[1]; i += 4) {
			if (
				array[i + 0] !== colorUint[0] ||
				array[i + 1] !== colorUint[1] ||
				array[i + 2] !== colorUint[2] ||
				array[i + 3] !== colorUint[3]
			) {
				array[i + 0] = colorUint[0]
				array[i + 1] = colorUint[1]
				array[i + 2] = colorUint[2]
				array[i + 3] = colorUint[3]
				needsUpdate = true
			}
		}

		if (needsUpdate) {
			attr.updateRanges = attr.updateRanges ?? []
			attr.updateRanges.push({
				start: range[0],
				count: range[1] - range[0],
			})
			attr.version++
		}
	}

	/**
	 * 更新SelectLine高亮样式
	 * @param feature
	 */
	updateSelectLineHighlight(feature) {
		this._updateFeatureHighlight(feature, 'select')
	}

	restoreSelectLineHighlight(feature) {
		this._restoreFeatureHighlight(feature, 'select')
	}

	/**
	 * 恢复SelectLine原始Default样式
	 */
	restoreSelectLines() {
		this._restoreLineColors('select')
	}

	/**
	 * 清除SelectLine的updateRanges，即清除之前的更新信息
	 */
	clearSelectLineUpdteRanges() {
		this._clearLineUpdteRanges('select')
	}

	/**
	 * 更新HoverLine高亮样式
	 * @param feature
	 */
	updateHoverLineHighlight(feature) {
		this._updateFeatureHighlight(feature, 'hover')
	}

	restoreHoverLineHighlight(feature) {
		this._restoreFeatureHighlight(feature, 'hover')
	}

	/**
	 * 恢复HoverLine原始Default样式
	 */
	restoreHoverLines() {
		this._restoreLineColors('hover')
	}

	/**
	 * 清除HoverLine的updateRanges，即清除之前的更新信息
	 */
	clearHoverLineUpdteRanges() {
		this._clearLineUpdteRanges('hover')
	}

	private _updateFeatureHighlight(feature, mode: 'select' | 'hover') {
		const info = this.featLineInfoMap.get(feature)
		if (info) {
			let indicator: LineIndicator
			switch (mode) {
				case 'select':
					indicator = this.selectIndicator
					break
				case 'hover':
					indicator = this.hoverIndicator
					break
				default:
					return
			}
			info.forEach((item) => {
				if (indicator) {
					indicator.updateHighlightByOffsetCount(item.offset, item.count)
				}
			})
		}
	}

	private _restoreFeatureHighlight(feature, mode: 'select' | 'hover') {
		const info = this.featLineInfoMap.get(feature)
		if (info) {
			let indicator: LineIndicator
			switch (mode) {
				case 'select':
					indicator = this.selectIndicator
					break
				case 'hover':
					indicator = this.hoverIndicator
					break
				default:
					return
			}
			info.forEach((item) => {
				if (indicator) {
					indicator.restoreHighlightByOffsetCount(item.offset, item.count)
				}
			})
		}
	}

	private _restoreLineColors(mode: 'select' | 'hover') {
		let indicator: LineIndicator
		switch (mode) {
			case 'select':
				indicator = this.selectIndicator
				break
			case 'hover':
				indicator = this.hoverIndicator
				break
			default:
				return
		}
		if (indicator) {
			indicator.restoreDefaultColorAll()
		}
	}

	private _clearLineUpdteRanges(mode: 'select' | 'hover') {
		let indicator: LineIndicator
		switch (mode) {
			case 'select':
				indicator = this.selectIndicator
				break
			case 'hover':
				indicator = this.hoverIndicator
				break
			default:
				return
		}
		if (indicator) {
			indicator.clearUpdateRanges()
		}
	}

	private _getLinePositions(feature, projection, alt = 0) {
		const baseAlt = this.getProps('baseAlt')
		const getThickness = this.getProps('getThickness')
		const lineHeight = this.getProps('selectLinesHeight')
		let geom: any = getGeom(feature)
		if (geom) {
			const linePositions: number[][] = []
			// 如果Geojson数据是Polygon类型，需要先转换为LineString
			if (geom.type === 'Polygon') {
				const line: any = polygonToLine(feature)
				geom = getGeom(line)
				const positionsArr = this._getGeomPositions(
					geom,
					projection,
					baseAlt + getThickness(feature) + alt + lineHeight
				)
				positionsArr?.forEach((positions) => {
					linePositions.push(positions)
				})
			} else if (geom.type === 'MultiPolygon') {
				const line: any = polygonToLine(feature)
				line.features.forEach((feature) => {
					geom = feature.geometry
					const positionsArr = this._getGeomPositions(
						geom,
						projection,
						baseAlt + getThickness(feature) + alt + lineHeight
					)
					positionsArr?.forEach((positions) => {
						linePositions.push(positions)
					})
				})
			}
			return linePositions
		}
	}

	private _getGeomPositions(geom, projection, alt): number[][] | undefined {
		const results: number[][] = []
		if (geom.type === 'LineString') {
			const positions: number[] = []
			const coords = getCoords(geom)
			coords.forEach((coord) => {
				const xyz = projection.project(coord[0], coord[1], alt)
				positions.push(...xyz)
			})
			results.push(positions)
			return results
		} else if (geom.type === 'MultiLineString') {
			const multiCoords: any[] = getCoords(geom)
			multiCoords.forEach((coords) => {
				const positions: number[] = []
				coords.forEach((coord) => {
					const xyz = projection.project(coord[0], coord[1], alt)
					positions.push(...xyz)
				})
				results.push(positions)
			})
			return results
		} else {
			console.error('PolygonLayer - Geojson geom type is not valid', geom.type, geom)
		}
	}

	private _removeIndicator(indicator: LineIndicator) {
		indicator && indicator.removeFromLayer()
	}

	private _getCachedGeom(features: any[]): GeomCacheType | undefined {
		const cacheCount = this.getProps('maxMemCacheCount')
		if (cacheCount <= 0) return
		/**
		 * 1. Get data cache key
		 * 2. Find geom from mem cache
		 * 3. return
		 */
		let cacheKey = ''
		features.forEach((feature) => {
			const str = getFeatureStringKey(feature, this.getProps('featureStorageKey'))
			if (str) {
				cacheKey += str + '|'
			} else {
				console.error(
					'Polaris::PolygonLayer - Feature key is undefined, check cache key props plz. '
				)
			}
		})
		return this._geomCache.get(cacheKey)
	}
}

type GeomCacheType = {
	geom: Geom
	selectIndicator: LineIndicator
	hoverIndicator: LineIndicator
}