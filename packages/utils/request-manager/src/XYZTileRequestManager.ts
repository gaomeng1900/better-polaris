import { CommonRequestManager } from './CommonRequestManager'
import { ConfigType } from './types'

export type XYZTileArgs = { x: number; y: number; z: number }

export interface XYZTileRequestManagerConfig extends ConfigType {
	getUrl: (requestArgs: XYZTileArgs) => string | { url: string; requestParams?: any }
	getCacheKey?: (requestArgs: XYZTileArgs) => string
	fetcher?: (requestArgs: XYZTileArgs) => Promise<any>
}

export class XYZTileRequestManager extends CommonRequestManager<XYZTileArgs> {
	readonly config: XYZTileRequestManagerConfig

	constructor(config: XYZTileRequestManagerConfig) {
		super(config)
		if (!this.config.getUrl) {
			throw new Error('XYZTileRequestManager - config.getUrl param is essential. ')
		}
	}

	getCacheKey(requestArgs: XYZTileArgs) {
		if (this.config.getCacheKey) {
			return this.config.getCacheKey(requestArgs)
		}
		const { x, y, z } = requestArgs
		return `${x}|${y}|${z}`
	}

	dispose() {
		this._requestCacheMap.clear()
		this._dataCacheMap.clear()
	}

	protected fetchDataDefault(requestArg: XYZTileArgs): Promise<any> {
		const requestInfo = this.config.getUrl(requestArg)
		const url = typeof requestInfo === 'string' ? requestInfo : requestInfo.url
		const requestParams = typeof requestInfo === 'string' ? undefined : requestInfo.requestParams

		return new Promise((resolve, reject) => {
			fetch(url, requestParams).then((res) => {
				if (!res.ok) {
					reject(res)
					return
				}
				switch (this.config.dataType) {
					case 'auto': {
						const data = this.getDataFromResponse(res)
						if (data) {
							resolve(data)
						} else {
							reject(new Error('Unknown Response Content-Type'))
						}
						break
					}
					case 'arraybuffer': {
						resolve(res.arrayBuffer())
						break
					}
					case 'json': {
						resolve(res.json())
						break
					}
					case 'text': {
						resolve(res.text())
						break
					}
					default: {
						resolve(res)
					}
				}
			})
		})

		// requestParams = requestParams || {}
		// return new Promise((resolve, reject) => {
		// 	const xhr = new XMLHttpRequest()
		// 	xhr.responseType = this.config.dataType
		// 	const listener = (e) => {
		// 		const status = xhr.status
		// 		if (status === 200) {
		// 			resolve(xhr.response)
		// 		} else if (status === 400) {
		// 			reject(new Error('Request failed because the status is 404'))
		// 		} else {
		// 			reject(new Error('Request failed because the status is not 200'))
		// 		}
		// 	}
		// 	xhr.addEventListener('loadend', listener)
		// 	xhr.addEventListener('error', (e) => {
		// 		reject(new Error('Request failed'))
		// 	})
		// 	xhr.open(requestParams.method || 'GET', url)
		// 	xhr.send()
		// })
	}
}
