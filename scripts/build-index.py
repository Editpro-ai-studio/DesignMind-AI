# Wraps the shared app page into index.html for GitHub Pages.
import sys,pathlib
app=pathlib.Path(sys.argv[1]).read_text()
head='''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="Personal studio for fashion trend research, fabric intelligence and textile design.">
<link rel="icon" href="assets/icon.svg" type="image/svg+xml">
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#2C3C93">
<link rel="apple-touch-icon" href="assets/icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="DesignMind">
<title>DesignMind AI</title>
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
<script src="assets/static.js"></script>
</head>
<body>
'''
pathlib.Path(sys.argv[2]).write_text(head+app+'\n</body>\n</html>\n')
