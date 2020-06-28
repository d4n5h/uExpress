const { flatten } = require('array-flatten');
const uWS = require('uWebSockets.js');
var slice = Array.prototype.slice;
var pathMatch = require('path-match')({
    sensitive: false,
    strict: false,
    end: false,
});

const parseQuery = function (query) {
    query = query.split('&');
    let results = {};
    for (let i = 0; i < query.length; i++) {
        const kv = query[i].split('=');
        if (kv.length > 1) {
            results[kv[0]] = kv[1];
        }
    }
    return results;
}

const parseReq = function (path, req) {
    req.query = parseQuery(req.getQuery());
    let basePath = req.getUrl().split('/')
    delete basePath[0]
    delete basePath[1]
    basePath = basePath.join('/').replace(/\/+/g, '\/')
    const match = pathMatch(path);
    req.params = match(basePath);
    return req;
}

const methods = ['get', 'post', 'put', 'del', 'any', 'ws', 'patch', 'listen', 'connect', 'options', 'trace', 'publish', 'head']
const exclude = ['ws', 'listen', 'connect', 'options', 'trace']

const uExpress = function (options = {}) {
    if (options.ssl) {
        this.app = uWS.SSLApp(options.ssl);
    } else {
        this.app = uWS.App();
    }

    this.stack = [];
    this.req = {};

    this.bodyParser = function (type, res, cb) {
        let buffer;
        let err = false;
        if (type == 'json') {
            res.onData((ab, isLast) => {
                let chunk = Buffer.from(ab);
                if (isLast) {
                    let json;
                    if (buffer) {
                        try {
                            json = JSON.parse(Buffer.concat([buffer, chunk]));
                        } catch (e) {
                            err = e;
                        } finally {
                            cb(json, err);
                        }
                    } else {
                        try {
                            json = JSON.parse(chunk);
                        } catch (e) {
                            err = e;
                        } finally {
                            cb(json, err);
                        }
                    }
                } else {
                    if (buffer) {
                        buffer = Buffer.concat([buffer, chunk]);
                    } else {
                        buffer = Buffer.concat([chunk]);
                    }
                }
            });
        } else if (type == 'raw') {
            try {
                res.onData((ab, isLast) => {
                    let chunk = Buffer.from(ab);
                    if (isLast) {
                        if (buffer) {
                            buffer += String(chunk)
                        } else {
                            buffer = String(chunk)
                        }
                        cb(buffer)
                    } else {
                        if (buffer) {
                            buffer += String(chunk)
                        } else {
                            buffer = String(chunk)
                        }
                    }
                });
            } catch (e) {
                err = e
            }
        }

        res.onAborted(cb(null, err));
    }

    this.set = function (key, val) {
        this.req[key] = val;
        return this;
    }

    this.use = function use(fn) {
        let offset = 0;
        let path = '/';

        if (typeof fn !== 'function') {
            let arg = fn;

            while (Array.isArray(arg) && arg.length !== 0) {
                arg = arg[0];
            }

            if (typeof arg !== 'function') {
                offset = 1;
                path = fn;
            }
        }

        const callbacks = flatten(slice.call(arguments, offset));

        callbacks.forEach((callback) => {
            if (callback.stack) {
                req = Object.assign(callback.req, this.req)
                callback.stack.forEach((cb) => {
                    this.stack.push({
                        path: path + cb.path, isMw: cb.isMw, method: cb.method, callback: function (res, req) {
                            req = Object.assign(req, this.req)
                            req = parseReq(cb.path, req);
                            cb.callback(res, req)
                        }
                    })
                })
                const newReqs = Object.keys(callback.req);
                for (let i = 0; i < newReqs.length; i++) {
                    const key = newReqs[i];
                    const val = callback.req[key];
                    this.req[key] = val;
                }
            } else {
                if (path == '/') {
                    path = '/*'
                }
                this.stack.push({
                    path: path, isMw: true, method: 'any', callback: (res, req) => {
                        req = Object.assign(req, this.req)
                        req = parseReq(path, req);
                        req.setYield(true);
                        res.onAborted(() => {
                            res.aborted = true;
                        });
                        callback(res, req);
                    }
                })
            }
        })
        return this;
    };

    const that = this;
    methods.forEach(method => {
        uExpress.prototype[method] = function (path, callback) {
            this.stack.push({
                path: path, method: method, callback: function (res, req) {
                    req = Object.assign(req, that.req)
                    req = parseReq(path, req);
                    callback(res, req)
                }
            })
            return this
        }
    });

    this.listen = function (port, cb) {
        for (let i = 0; i < this.stack.length; i++) {
            const route = this.stack[i];
            if (route.path.includes('*') && route.isMw) {
                const base = route.path.split('*')[0];
                for (let x = 0; x < this.stack.length; x++) {
                    if (this.stack[x].path.includes(base) && !this.stack[x].path.includes('*') && !this.stack[x].isMw && !exclude.includes(this.stack[x].method)) {
                        this.app[this.stack[x].method](this.stack[x].path, route.callback)
                    }
                }
            } else {
                this.app[route.method](route.path, route.callback)
            }
        }
        this.app.listen(port, cb);

    }
    return this;

}

module.exports = uExpress;