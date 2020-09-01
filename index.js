const uWS = require('uWebSockets.js'),
    fs = require('fs'),
    p = require('path'),
    mime = require('mime-types'),
    Busboy = require('busboy'),
    { v4: uuid } = require('uuid'),
    querystring = require('querystring'),
    slice = Array.prototype.slice,
    methods = ['get', 'post', 'put', 'del', 'any', 'ws', 'patch', 'listen', 'connect', 'options', 'trace', 'publish', 'head'],
    exclude = ['ws', 'listen', 'connect', 'options', 'trace'];

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
    this.writeHeader('Content-Type', 'application/json; charset=utf-8');
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


function parseCookies(cookieHeader = '') {
    const cookies = cookieHeader.split(/; */);
    const decode = decodeURIComponent;

    if (cookies[0] === '') return {};

    const result = {};
    for (let cookie of cookies) {
        const isKeyValue = cookie.includes('=');

        if (!isKeyValue) {
            result[cookie.trim()] = true;
            continue;
        }

        let [key, value] = cookie.split('=');

        key.trim();
        value.trim();

        if ('"' === value[0]) value = value.slice(1, -1);

        try {
            value = decode(value);
        } catch (error) {
            // neglect
        }
        result[key] = value;
    }

    return result;
};

async function parseBody(response) {
    let chunks;
    return new Promise((resolve, reject) => {
        response.onData((ab, isLast) => {
            let chunk = Buffer.from(ab);
            chunks = chunks ? Buffer.concat([chunks, chunk]) : Buffer.concat([chunk]);
            if (isLast) {
                try {
                    resolve(chunks);
                } catch (error) {
                    resolve({});
                }
            }
        });
    });
};

async function requestParser(options) {
    if (!options) options = {};
    if (!options.uploadPath) options.uploadPath = './';
    if (!options.limits) options.limits = {};
    const that = this;
    return new Promise(async (resolve, reject) => {
        try {
            const buffer = await parseBody(that);
            let context = {};
            context.body = {};
            const headers = that.headers;
            context.headers = headers;
            if (headers['cookie']) context.cookies = parseCookies(headers['cookie']);
            if (buffer.length > 0) {
                const contentType = headers['content-type'].split(';')[0];
                switch (contentType) {
                    case 'text/plain':
                        context.body = buffer.toString();
                        resolve(context);
                        break;
                    case 'application/x-www-form-urlencoded':
                        const form = querystring.parse(buffer.toString());
                        context.body = form;
                        resolve(context);
                        break;
                    case 'application/json':
                        const body = JSON.parse(buffer);
                        if (typeof body === "object") {
                            context.body = body;
                        }
                        resolve(context);
                        break;
                    case 'multipart/form-data':
                        const busboy = new Busboy({ headers, limits: options.limits });
                        busboy.on('file', function (fieldname, file, filename, encoding, mimetype) {
                            let extension = filename.split('.');
                            extension = extension[extension.length - 1];
                            let newFile = null;
                            if (options.uniquePaths) {
                                newFile = uuid() + '.' + extension;
                                fstream = fs.createWriteStream(options.uploadPath + newFile);
                            } else {
                                fstream = fs.createWriteStream(options.uploadPath + filename);
                            }

                            if (typeof options.fileLimit == 'function') file.on('limit', () => {
                                options.fileLimit(fieldname, file, filename, encoding, mimetype);
                            });

                            let bytes = 0;
                            file.on('data', function (data) {
                                bytes = bytes + data.length;
                            })

                            file.pipe(fstream);
                            fstream.on('close', function () {
                                if (typeof options.fstreamClosed == 'function') options.fstreamClosed(fieldname, file, filename, encoding, mimetype);
                            });
                            file.on('end', () => {
                                if (typeof options.fileEnd == 'function') options.fileEnd(fieldname, file, filename, encoding, mimetype);
                                if (!context.body[fieldname]) context.body[fieldname] = [];
                                let pushed = {
                                    filename: filename,
                                    encoding,
                                    mimetype,
                                    bytes: bytes
                                };
                                if (newFile) pushed.uniquePath = newFile;
                                context.body[fieldname].push(pushed)
                            });
                        });
                        busboy.on('field', (fieldname, val) => {
                            const { params } = context;
                            context.body = { ...params, [fieldname]: val };
                        });
                        busboy.on('finish', () => {
                            resolve(context)
                        });
                        busboy.end(buffer);
                        break;
                }
            }
        } catch (e) {
            reject(e);
        }
    })
}

const uExpress = function (options = {}) {
    this.uWS = uWS;
    if (options.ssl) {
        this.app = this.uWS.SSLApp(options.ssl);
    } else {
        this.app = this.uWS.App();
    }

    this.stack = [];
    this.req = {};
    this.kind = 'app_instance';

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
        res.requestParser = requestParser;
        return res;
    };

    this.set = function (key, val) {
        if (!key) throw 'Set key cannot be empty'
        if (!val) throw 'Set value cannot be empty'
        this.req[key] = val;
        return this;
    }

    this.use = function use(fn) {
        if (!fn) throw 'Use must have an argument'
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
                    if (cb.method == 'ws') {
                        this.stack.push({
                            path: path + cb.path, isMw: cb.isMw, method: cb.method, callback: cb.callback
                        })
                    } else {
                        this.stack.push({
                            path: path + cb.path, isMw: cb.isMw, method: cb.method, callback: function (res, req) {
                                req = that.patchReq(req);
                                let headers = {};
                                req.forEach((k, v) => {
                                    headers[k] = v;
                                });
                                res.headers = headers;
                                res = that.patchRes(res);

                                cb.callback(res, req);
                            }
                        })
                    }
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
        uExpress.prototype[method] = function () {
            const args = Array.prototype.slice.call(arguments);
            if (method == 'ws') {
                const path = args[0],
                    options = args[1];
                this.stack.push({
                    path: path, method: method, options: options
                })
            } else {
                const path = args[0],
                    callback = args[1];
                this.stack.push({
                    path: path, method: method, callback: function (res, req) {
                        req = that.patchReq(req);
                        let headers = {};
                        req.forEach((k, v) => {
                            headers[k] = v;
                        });
                        res.headers = headers;
                        res = that.patchRes(res);
                        callback(res, req);
                    }
                })
            }
            return this;
        }
    });

    this.inject = function (data) {
        if (!data.inject) throw 'Injectable must include an "inject" object'
        switch (data.inject.type) {
            case 'ws':
                this.ws(data.inject.path, data.inject.data)
                break;
            default:
                break;
        }
    }

    this.wss = function () {
        const args = Array.prototype.slice.call(arguments);
        this.inject = {
            type: 'ws',
            path: args[0],
            data: { ...args[1] }
        }
        this.on = (handler, fn) => {
            this.inject.data[handler] = fn;
        }
    }

    this.listen = function (port, cb) {
        if (!port) throw 'You must pass port as an argument in app listen'
        if (typeof cb != 'function') throw 'You must pass a callback as an argument in app listen'
        if (this.req.static) {
            this.get(this.req.static, (res, req) => {
                const filename = p.join(process.cwd(), req.getUrl());
                if (fs.existsSync(filename)) {
                    const contentType = mime.lookup(filename),
                        totalSize = fs.statSync(filename).size,
                        readStream = fs.createReadStream(filename);
                    res.writeHeader('Content-Type', contentType);
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
                if (route.method == 'ws') {
                    this.app[route.method](route.path, route.options);
                } else {
                    this.app[route.method](route.path, route.callback);
                }
            }
        }
        this.app.listen(port, cb);
    }
    return this;

}

module.exports = uExpress;