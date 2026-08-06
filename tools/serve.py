#!/usr/bin/env python3
"""Local preview that behaves like GitHub Pages.

A plain static server is not good enough here: the site links to extensionless
URLs like /islamic-quiz, which GitHub Pages resolves to islamic-quiz.html. This
serves the same way and falls back to 404.html, so what you test matches production.

    python3 tools/serve.py           # http://localhost:8080
    python3 tools/serve.py 8081
"""

import functools
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        local = super().translate_path(path.split("?", 1)[0].split("#", 1)[0])
        if os.path.isdir(local):
            index = os.path.join(local, "index.html")
            return index if os.path.exists(index) else local
        # Extensionless URL: GitHub Pages appends .html.
        if not os.path.exists(local) and not os.path.splitext(local)[1]:
            if os.path.exists(local + ".html"):
                return local + ".html"
        return local

    def send_head(self):
        if not os.path.exists(self.translate_path(self.path)):
            fallback = os.path.join(ROOT, "404.html")
            if os.path.exists(fallback):
                body = open(fallback, "rb").read()
                self.send_response(404)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                return __import__("io").BytesIO(body)
        return super().send_head()

    def end_headers(self):
        # Never cache, so edits show up on a plain reload.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    handler = functools.partial(Handler, directory=ROOT)
    print(f"Serving {ROOT}\nhttp://localhost:{port}\n")
    try:
        HTTPServer(("", port), handler).serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
