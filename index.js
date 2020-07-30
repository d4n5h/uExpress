const uWS = require('uWebSockets.js'),
    fs = require('fs'),
    p = require('path'),
    mime = require('mime-types'),
    slice = Array.prototype.slice;

function parseQuery(query) {
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

function status(status) {
    this.writeStatus(String(status))
    return this
}

function send(data) {
    this.end(data)
    return this
}

function sendFile(filePath) {
    const contentType = mime.lookup(filePath);
    this.writeHeader('Content-Type', contentType);
    const totalSize = fs.statSync(filePath).size;
    const readStream = fs.createReadStream(filePath);
    pipeStreamOverResponse(this, readStream, totalSize);
    return this
}


function json(data) {
    this.writeHeader('Content-Type', 'text/html; charset=utf-8');
    this.writeHeader('Content-Type', 'text/json');
    this.end(JSON.stringify(data))
    return this
}

function toArrayBuffer(buffer) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function onAbortedOrFinishedResponse(res, readStream) {
    if (res.id != -1) {
        readStream.destroy();
    }
    res.id = -1;
}

function pipeStreamOverResponse(res, readStream, totalSize) {
    readStream.on('data', (chunk) => {
        const ab = toArrayBuffer(chunk);
        let lastOffset = res.getWriteOffset();
        let [ok, done] = res.tryEnd(ab, totalSize);
        if (done) {
            onAbortedOrFinishedResponse(res, readStream);
        } else if (!ok) {
            readStream.pause();
            res.ab = ab;
            res.abOffset = lastOffset;

            res.onWritable((offset) => {
                let [ok, done] = res.tryEnd(res.ab.slice(offset - res.abOffset), totalSize);
                if (done) {
                    onAbortedOrFinishedResponse(res, readStream);
                } else if (ok) {
                    readStream.resume();
                }
                return ok;
            });
        }

    }).on('error', (err) => {
        console.log(err);
    });
};

const methods = ['get', 'post', 'put', 'del', 'any', 'ws', 'patch', 'listen', 'connect', 'options', 'trace', 'publish', 'head']
const exclude = ['ws', 'listen', 'connect', 'options', 'trace']

const uExpress = function (options = {}) {
    this.uWS = uWS;
    if (options.ssl) {
        this.app = this.uWS.SSLApp(options.ssl);
    } else {
        this.app = this.uWS.App();
    }

    this.stack = [];
    this.req = {};

    this.patchReq = (req) => {
        req = Object.assign(req, this.req);
        req.query = parseQuery(req.getQuery());
        return req;
    }

    this.patchRes = (res) => {
        res.json = json;
        res.status = status;
        res.send = send;
        res.sendFile = sendFile;
        return res;
    };

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
                            buffer += String(chunk);
                        } else {
                            buffer = String(chunk);
                        }
                        cb(buffer);
                    } else {
                        if (buffer) {
                            buffer += String(chunk);
                        } else {
                            buffer = String(chunk);
                        }
                    }
                });
            } catch (e) {
                err = e;
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

        const callbacks = (slice.call(arguments, offset)).flat();;
        const that = this;
        callbacks.forEach((callback) => {
            if (callback.stack) {
                req = Object.assign(callback.req, this.req)
                callback.stack.forEach((cb) => {
                    this.stack.push({
                        path: path + cb.path, isMw: cb.isMw, method: cb.method, callback: function (res, req) {
                            req = that.patchReq(req);
                            res = that.patchRes(res);
                            cb.callback(res, req);
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
                    path = '/*';
                }
                this.stack.push({
                    path: path, isMw: true, method: 'any', callback: (res, req) => {
                        req = this.patchReq(req);
                        req.setYield(true);
                        res = this.patchRes(res);
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
                    req = that.patchReq(req);
                    res = that.patchRes(res);
                    callback(res, req);
                }
            })
            return this;
        }
    });

    this.listen = function (port, cb) {
        if (this.req.static) {
            this.get(this.req.static, (res, req) => {
                const filename = p.join(process.cwd(), req.getUrl());
                if (fs.existsSync(filename)) {
                    const contentType = mime.lookup(filename);
                    res.writeHeader('Content-Type', contentType);
                    const totalSize = fs.statSync(filename).size;
                    const readStream = fs.createReadStream(filename);
                    pipeStreamOverResponse(res, readStream, totalSize);
                    res.onAborted(() => {
                        res.aborted = true;
                    });
                } else {
                    res.writeStatus('404').end()
                }
            })
        }

        for (let i = 0; i < this.stack.length; i++) {
            const route = this.stack[i];
            if (route.path.includes('*') && route.isMw) {
                const base = route.path.split('*')[0];
                for (let x = 0; x < this.stack.length; x++) {
                    if (this.stack[x].path.includes(base) && !this.stack[x].path.includes('*') && !this.stack[x].isMw && !exclude.includes(this.stack[x].method)) {
                        this.app[this.stack[x].method](this.stack[x].path, route.callback);
                    }
                }
            } else {
                this.app[route.method](route.path, route.callback);
            }
        }
        this.app.listen(port, cb);

    }
    return this;

}

module.exports = uExpress;