StreamSaver.js
==============

First I want to thank [eli grey][1] for a fantastic work implementing the
[FileSaver.js][2] to save files & blob's so easily!
But there is one obstacle - The RAM it can hold and the max blob size limitation

StreamSaver.js takes a different approach. Instead of saving data in client-side
storage or in memory you could now actually create a writable stream directly to
the file system (I'm not talking about chromes sandboxed file system)

StreamSaver.js is the solution to saving streams on the client-side.
It is perfect for webapps that need to save really large amount of data created
on the client-side where the RAM is really low like on mobile devices



Syntax:

This is what I'm aiming for and this is what StreamSaver.js eventually will become.
```javascript
// High level api
saveStream(stream, 'filename')
```

But for now it's a lower level api where you need to create your own MessageChannel,
Queuing system, post messaging, listen for when it's ready to start accepting data
and when you should also close the stream at the end or abort when you wish to

All this should eventually be handle by the stream itself with back pressure and
by listening for abort and close events

So go ahead and skim the [example.html][3] file instead



How is this possible?
====
Good that you asked.
There is not any magical save() function that saves a stream, file or blob...
Apart from Microsoft that decided to implement there own non standard msSaveOrOpenBlob
syntax. [FileSaver.js][2] is solving File & Blob by creating a objectUrl, add it
to a link element and the open it with a help of a download attribute. Unfortunately
this don't work for streams...

The one and only other solution is to do what the server dose: send a Content-Disposition
header to tell the browser to save the file. But we don't have a server. So the
only solution is to create a service worker that can intercept links and use
[respondWith()][4]
This will scream high restriction just by mentioning service worker. It's such a
powerful tool that it need to run on https <s>but there is a workaround for http
sites: iframes + 3th party https site. Who would have guess that iframe could be so helpful?
But i won't go into details on that.</s> tried it on the demo site and didn't work, were not allowed
to register service worker when parent was on http... popups?

So it all boils down to using
serviceWorker, MessageChannel, postMessage, fetch, respondWith, iframes (for http -> https -> serviceWorker),
and last but not least: a flag that enables you to construct ReadableStream `chrome://flags/#enable-experimental-web-platform-features`



```bash
# A simple php or python server is enough
php -S localhost:3000 & php -S localhost:3001
python -m SimpleHTTPServer 3000 & python -m SimpleHTTPServer 3001
```

[1]: https://github.com/eligrey
[2]: https://github.com/eligrey/FileSaver.js
[3]: https://github.com/jimmywarting/StreamSaver.js/blob/master/example.html
[4]: https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith
