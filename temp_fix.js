var fs = require("fs");
var path = require("path");
var BASE = "/Users/koillinjag/Desktop/solocoder/45";
function r(p) { return fs.readFileSync(path.join(BASE, p), "utf8"); }
function w(p, c) { fs.writeFileSync(path.join(BASE, p), c); }
function done(msg) { process.stdout.write(msg + "\n"); }

