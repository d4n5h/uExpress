let app = require('../index.js');
const path = require('path');

const fs = require('fs');
const port = 9001;

app = new app();

// Serve Static-ish
app.set('static', '/assets/*');

// Morgan-ish
app.use((res, req) => {
    console.log(req.getMethod() + ' => ' + req.getUrl())
})

// Security Headers
app.use((res, req) => {
    res.writeHeader('X-Download-Options', 'noopen');
    res.writeHeader('X-Content-Type-Options', 'nosniff');
    res.writeHeader('X-XSS-Protection', '1; mode=block');
    res.writeHeader('X-Powered-By', 'None');
})

app.use((res, req) => {
    app.req.test = 'test'
})

app.get('/api/:id', (res, req) => {
    const id = req.getParameter(0)
    console.log(id)
    console.log(req.test)
    res.end('asd')
})

app.post('/api/:id/:name', (res, req) => {
    // Can be 'json' or 'raw'
    const id = req.getParameter(0)
    const name = req.getParameter(1)

    res.onAborted(() => {
        res.aborted = true;
    });
    res.requestParser().then((context) => {
        res.status(200).json(context);
    });
})

// Create a WS Server
const ws = new app.wss('/socket', { compression: app.uWS.SHARED_COMPRESSOR });

// ws.on('upgrade', (res, req) => {
//     console.log('asd');
// });

ws.on('message', (ws, message, isBinary) => {
    console.log(message)
    ws.send(message, isBinary);
});

ws.on('open', (ws) => {
    console.log('Connected')
});

ws.on('closed', (ws) => {
    console.log('Disconnected')
});

app.inject(ws);

// Load another route
// app.use('/routePath', route)


app.post('/upload', (res, req) => {
    res.onAborted(() => {
        res.aborted = true;
    });
    function fstreamClosed(fieldname, file, filename, encoding, mimetype) {
        console.log(filename, 'Stream Closed');
    }
    function fileEnd(fieldname, file, filename, encoding, mimetype) {
        console.log(filename, 'Finished');
    }
    function limit(fieldname, file, filename, encoding, mimetype) {
        console.log(filename, 'Over limit!');
    }
    res.requestParser({
        limits: {},
        uploadPath: __dirname + '/files/',
        uniquePaths: true,
        fileEnd: fileEnd,
        fstreamClosed: fstreamClosed,
        fileLimit: limit
    }).then((context) => {
        res.status(200).json(context);
    });
})

app.post('/upload', (res, req) => {
    res.writeHeader('Content-Transfer-Encoding', 'binary');
    res.writeHeader('Content-Description', 'File Transfer');
    let fields = [];
    let boundary = null;
    let keep = false;
    let b;
    let streams = {};
    let count = 0;
    let keepCount = 0;
    res.onData((chunk, isLast) => {
        let buff = Buffer.concat([Buffer.from(chunk)]);
        buff = buff.toString('binary');
        buff = buff.split('\r\n');
        if (!boundary) {
            boundary = buff[0];
        }
        for (let i = 0; i < buff.length; i++) {
            const line = buff[i];
            if (line == boundary) {
                fields[fields.length] = {};
            }

            if (count > 1 && fields[fields.length - 1].filename && line == boundary + '--' || count > 1 && fields[fields.length - 1].filename && line == boundary) {
                streams[fields[fields.length - 1].filename].end();
                keep = false;
            }

            if (line.includes('Content-Disposition')) {
                if (line.includes('filename="')) {
                    fields[fields.length - 1].filename = getFilename(line);
                    fields[fields.length - 1].type = 'file';
                    streams[fields[fields.length - 1].filename] = fs.createWriteStream(
                        path.resolve('./files/' + fields[fields.length - 1].filename)
                    );
                } else {
                    fields[fields.length - 1].type = 'field';
                }
                fields[fields.length - 1].name = getField(line);
            }
            if (line.includes('Content-Type')) {
                fields[fields.length - 1].contentType = line.split('Content-Type: ')[1];
            }
            if (line == '') {
                keep = true;
            }
            if (keep == true && line != '') {

                if (fields[fields.length - 1].filename) {
                    streams[fields[fields.length - 1].filename].write(Buffer.from(line + "\r\n", 'binary'));
                } else {
                    fields[fields.length - 1].value += line;
                }
            }



            if (line == boundary + '--') {
                keep = false;
                break;
            }
        }
        // console.log(buff)
        /*console.log(buff)
        for (let i = 0; i < buff.length; i++) {
            const line = buff[i];
            if (!boundary) {
                boundary = line;
                count++;
            };

            if (count > 1 && fields[fields.length - 1].filename && line == boundary + '--' || count > 1 && fields[fields.length - 1].filename && line == boundary) {
                streams[fields[fields.length - 1].filename].end();
            }

            if (line == boundary) {
                keep = false;
                fields[fields.length] = {}
            }

            if (boundary && line == boundary + '--' && !fields[fields.length - 1].filename || boundary && line == boundary && !fields[fields.length - 1].filename) {
                fields[fields.length - 1].value = b;
                b = '';
            }

            if (line.includes('Content-Disposition')) {
                if (line.includes('filename="')) {
                    fields[fields.length - 1].filename = getFilename(line);
                    fields[fields.length - 1].type = 'file';
                    keepCount = 0;
                    streams[fields[fields.length - 1].filename] = fs.createWriteStream(
                        path.resolve('./files/' + fields[fields.length - 1].filename)
                    );
                } else {
                    fields[fields.length - 1].type = 'field';
                }
                fields[fields.length - 1].name = getField(line);
            }

            if (line.includes('Content-Type')) {
                fields[fields.length - 1].contentType = line.split('Content-Type: ')[1];
            }

            if (line == boundary + '--') {
                break;
            }

            if (keep == true) {
                if (!fields[fields.length - 1].filename) {
                    b += line
                } else {
                    if(keepCount > 0){
                        if(keepCount == 1){
                            if(line != ''){
                                streams[fields[fields.length - 1].filename].write(Buffer.from(line + "\r\n", 'binary'));
                            }
                        } else {
                            streams[fields[fields.length - 1].filename].write(Buffer.from(line + "\r\n", 'binary'));
                        }
                    }
                }
            }

            if (line == '') {
                keep = true;
                keepCount++;
                continue;
            }
        }*/

        if (isLast) {
            // console.log(fields)
            // console.log(buffer);
            res.end("Finished");
        }
    });

    res.onAborted(() => {
        /* Request was prematurely aborted, stop reading */
        // fileStream.destroy();
        console.log("Eh, okay. Thanks for nothing!");
    });
})

app.any('/*', (res, req) => {
    res.writeStatus('404').end()
})

// console.log(app.stack);

app.listen(port, (token) => {
    if (token) {
        console.log('Listening to port ' + port);
    } else {
        console.log('Failed to listen to port ' + port);
    }
})