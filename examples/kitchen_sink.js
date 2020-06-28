let app = require('../index.js');
const port = 9001;

app = new app();

// bodyParser-ish
app.set('body', app.bodyParser);

// Serve Static-ish
app.set('static', '/assets/*');

// Morgan-ish
app.use((res, req) => {
    console.log(req.getMethod() + ' => ' + req.getUrl())
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

    req.body('json', res, (body, err) => {
        if (body && !err) {
            console.log(body)
        }
    })
    res.end('Posted!')
})

app.ws('/socket', {
    /* Options */
    compression: app.uWS.SHARED_COMPRESSOR,
    maxPayloadLength: 16 * 1024 * 1024,
    idleTimeout: 10,
    /* Handlers */
    upgrade: (res, req, context) => {
        console.log('An Http connection wants to become WebSocket, URL: ' + req.getUrl() + '!');

        /* Keep track of abortions */
        const upgradeAborted = { aborted: false };

        /* You MUST copy data out of req here, as req is only valid within this immediate callback */
        const url = req.getUrl();
        const authorization = req.getHeader('authorization');
        const secWebSocketKey = req.getHeader('sec-websocket-key');
        const secWebSocketProtocol = req.getHeader('sec-websocket-protocol');
        const secWebSocketExtensions = req.getHeader('sec-websocket-extensions');

        /* Simulate doing "async" work before upgrading */
        setTimeout(() => {
            console.log("We are now done with our async task, let's upgrade the WebSocket!");

            if (upgradeAborted.aborted) {
                console.log("Ouch! Client disconnected before we could upgrade it!");
                /* You must not upgrade now */
                return;
            }

            res.upgrade({ url: url }, authorization, secWebSocketKey, secWebSocketProtocol, secWebSocketExtensions, context);
        }, 1000);

        res.onAborted(() => {
            upgradeAborted.aborted = true;
        });
    },
    open: (ws) => {
        console.log('A WebSocket connected!');
    },
    message: (ws, message, isBinary) => {
        /* Ok is false if backpressure was built up, wait for drain */
        let ok = ws.send(message, isBinary);
    },
    drain: (ws) => {
        console.log('WebSocket backpressure: ' + ws.getBufferedAmount());
    },
    close: (ws, code, message) => {
        console.log('WebSocket closed');
    }
})

// Load another route
// app.use('/routePath', route)

app.any('/*',(res,req)=>{
    res.writeStatus('404').end()
})
app.listen(port, (token) => {
    if (token) {
        console.log('Listening to port ' + port);
    } else {
        console.log('Failed to listen to port ' + port);
    }
})