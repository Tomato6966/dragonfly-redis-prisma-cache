import { TedisPool, Tedis } from 'tedis';

export interface CacheOptions {
    storageOptions: {
        host?: string;
        port?: number;
        password?: string;
        timeout?: number;
        /** If undefined | <= 0 then no Pool will be used */
        min_conn?: number;
        max_conn?: number;
        tls?: {
          key: Buffer;
          cert: Buffer;
        };
    }
    /** IF I should cache all Models */
    useAllModels: boolean;
    defaultCacheActions?: string[],
    toCache: {
        /** all models to use () */
        model: string,
        /** all actions to use the cache on */
        actions: string[],
        /** Time to live in seconds */
        ttl?: number,
        /** Prefix for the cache key */
        prefix?: string
    }[]
}

export type MiddlewareParameters = {
    model?: string;
    action: string;
    args: any;
    dataPath: string[];
    runInTransaction: boolean;
}

class prismaDragonflyRedisCacheMiddleware <Prisma> {
    private client!: TedisPool | Tedis;
    private isPool!: boolean;
    private defaultCacheActions!: string[];
    private useAllModels!: boolean;
    private toCache!: {
        model: string,
        actions: string[],
        ttl?: number,
        prefix?: string
    }[];

    constructor(options: CacheOptions){
        validate(options)
        //bind(this);
        if(!options || (!options.toCache && !options.useAllModels) || !options.storageOptions) return;
        this.toCache = options?.toCache ?? [];
        this.defaultCacheActions = options.defaultCacheActions ?? [];
        this.useAllModels = options.useAllModels ?? !options?.toCache?.length ? true : false;
        this.isPool = !!(options?.storageOptions?.min_conn && options.storageOptions.min_conn >= 1)
        if(!this.isPool) {
            delete options.storageOptions.min_conn;
            delete options.storageOptions.max_conn;
        } else {
            // @ts-ignore
            if(!options.storageOptions?.max_conn) options.storageOptions.max_conn = options.storageOptions.min_conn + 1; else if(options.storageOptions?.max_conn <= options.storageOptions.min_conn) options.storageOptions.max_conn = options.storageOptions.min_conn + 1;
        }
        this.client = this.isPool ? new TedisPool(options.storageOptions!) : new Tedis(options.storageOptions);
        console.log("cache initiated")
    }

    async handle(params: MiddlewareParameters, next: (params: MiddlewareParameters) => Promise<any>){
        let result: any = null;
        const instance = this.toCache.find(instance => (this.useAllModels || instance.model === params.model) && (this.defaultCacheActions.includes(params.action) || instance.actions.includes(params.action)))
        if(instance){
            const cacheKey = `${instance.prefix ? `${instance.prefix}-`: ``}${params.model}:${params.action}:${JSON.stringify(params.args)}`;
            // @ts-ignore
            const tedis = this.isPool ? await this.client.getTedis() : this.client;
            const findCache = await tedis.get(cacheKey);

            if(findCache) {
                console.log("found something from the cache")
                result = JSON.parse(findCache);
            }
            else {
                // using stringified results, because that way it uses PPC2 from dragonfly to save 54% storage space
                result = await next(params);
                console.log("found something from the db: ", cacheKey)
                if(instance.ttl) {
                    await tedis.set(cacheKey, JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v)), 'EX', instance.ttl)
                } else {
                    await tedis.set(cacheKey, JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v)))
                }
            }
            // @ts-ignore
            if(this.isPool) await this.client.putTedis(tedis);
        } else console.log(`Could not find instance for ${params.model}`)

        // not cached
        if(!result) {
            result = await next(params);
        }
        
        return result;
    }
}

const gAllProps = (object: any) => {
	const p = new Set();
	do {
		for (const key of Reflect.ownKeys(object)) p.add([object, key]);
	} while ((object = Reflect.getPrototypeOf(object)) && object !== Object.prototype);
	return p;
};

function validate(options:CacheOptions) {
    if(!options || typeof options !== "object") throw new SyntaxError("no valid cacheOptions provided")
    if(typeof options.useAllModels !== "undefined" && typeof options.useAllModels !== "boolean") throw new SyntaxError("option useAllModels was not as a boolean provided");
    if(options.toCache && !Array.isArray(options.toCache)) throw new SyntaxError("No option toCache was provided / option toCache is not a valid Array");
    if(!options.toCache && !options.useAllModels) throw new SyntaxError("No toCache and no useAllModels provided..")
    if(!options.defaultCacheActions || !Array.isArray(options.defaultCacheActions)) throw new SyntaxError("No option defaultCacheActions was provided / option defaultCacheActions is not a valid Array");
    return true;
}
function bind(o: any) { // @ts-ignore
	for (const [object, key] of gAllProps(o.constructor.prototype)) {
		if (key === 'constructor') continue;
        // find the traget of the property
		const target = Reflect.getOwnPropertyDescriptor(object, key);
		if (target && typeof target.value === 'function') o[key] = o[key].bind(o);
	}
	return o;
}

export function prismaDragonflyRedisCache(options: CacheOptions) {
    const newCache = new prismaDragonflyRedisCacheMiddleware(options);
    return newCache.handle;
}
