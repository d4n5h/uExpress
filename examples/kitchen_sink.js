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