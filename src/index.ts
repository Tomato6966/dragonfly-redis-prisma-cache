import { TedisPool, Tedis } from 'tedis';
import { Prisma } from "prisma";

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

    toCache: {
        /** all models to use () */
        model: string,
        /** all actions to use the cache on */
        actions: string[],
        /** Time to live */
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
    private client: TedisPool | Tedis;
    private isPool: boolean;
    private useAllModels: boolean;
    private toCache: {
        model: string,
        actions: string[],
        ttl?: number,
        prefix?: string
    }[];

    constructor(options: CacheOptions){
        validate(options)
        bind(this);
        if(!options || !options.toCache || !options.storageOptions) return;
        this.toCache = options.toCache;
        this.useAllModels = options.useAllModels ?? false;
        this.isPool = !!(options?.storageOptions?.min_conn && options.storageOptions.min_conn >= 1)
        if(!this.isPool) {
            delete options.storageOptions.min_conn;
            delete options.storageOptions.max_conn;
        } else {
            if(!options.storageOptions?.max_conn) options.storageOptions.max_conn = options.storageOptions.min_conn + 1;
            else if(options.storageOptions?.max_conn <= options.storageOptions.min_conn) options.storageOptions.max_conn = options.storageOptions.min_conn + 1;
        }
        this.client = this.isPool ? new TedisPool(options.storageOptions) : new Tedis(options.storageOptions);
    }

    public async handle(params: MiddlewareParameters, next: (params: MiddlewareParameters) => Promise<any>){
        let result: any = null;
        const instance = this.toCache.find(instance => (this.useAllModels || instance.model === params.model) && instance.actions.includes(params.action))
        if(instance){
            const cacheKey = `${instance.prefix ? `${instance.prefix}-`: ``}${params.model}:${params.action}:${JSON.stringify(params.args)}`;
            // @ts-ignore
            const tedis = this.isPool ? await this.client.getTedis() : this.client;
            const findCache = await tedis.get(cacheKey);

            if(findCache) {
                result = JSON.parse(findCache);
            }
            else {
                // using stringified results, because that way it uses PPC2 from dragonfly to save 54% storage space
                result = await next(params);
                if(instance.ttl) {
                    await tedis.set(cacheKey, JSON.stringify(result), 'EX', instance.ttl)
                } else {
                    await tedis.set(cacheKey, JSON.stringify(result))
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
    if(typeof options.toCache !== "undefined" || !Array.isArray(options.toCache)) throw new SyntaxError("No option toCache was provided / option toCache is not a valid Array");
    return true;
}
function bind(o: any) {
	for (const [object, key] of gAllProps(o.constructor.prototype)) {
		if (key === 'constructor') continue;
        // find the traget of the property
		const target = Reflect.getOwnPropertyDescriptor(object, key);
		if (target && typeof target.value === 'function') o[key] = o[key].bind(o);
	}
	return o;
}

export function prismaDragonflyRedisCache(options: CacheOptions) {
    return new prismaDragonflyRedisCacheMiddleware(options).handle;
}
