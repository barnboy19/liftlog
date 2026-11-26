"""Local dev server that disables browser caching, so edits show up on reload.

Run from the project root:  python3 tools/serve.py [port]   (default 5173)
Plain `python3 -m http.server` lets the browser cache JS modules, which hides changes.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".webmanifest": "application/manifest+json", ".js": "text/javascript"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    root = Path(__file__).resolve().parent.parent
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(NoCacheHandler, directory=str(root)))
    print(f"Serving {root} at http://localhost:{port}")
    server.serve_forever()
