# Name Tag Maker

## The problem

My office is going to be hosting an event, and we wanted to have name tags for the employees that will be around to help out. We wanted to 3d print them. While making one such nametag is easy enough, doing it dozens of times to iterate on sizing and to make one for each person is a hassle.

## The what

So enter this tool, which makes a 3d model with various options. You can set the text, of course, but you can also tweak the sizing, amount of fillet, etc. You can also specify a custom image (SVG) and font (TTF) for the app to use. Once set, the image and font will persist between runs.

You can make tags one at a time and save them as STLs, but that would still be a hassle. You can also load a CSV file of names and have the app make all of them at once. If you do that, it will create each nametag and arrange them such they fill your print bed (220x220 by default, but settable in "Settings"). 

Once you have your full collection of tags, you can export them, and the app will save a single STL for each print bed.

## The how

This is implemented as an Electron app, using typescript, React, and the MUI library and for the 3d, I'm using ThreeJS for the rendering and camera control.

But the real magic / heavy lifting is thanks to [opencascadejs](https://ocjs.org/), the WASM port of the [OpenCascade](https://dev.opencascade.org/) open-source CAD kernel. This means that the app can do actual, proper CAD operations, like filleting edges, and output proper clean geometry.

I went with webtech + Electron both because I love webtech, but also because it means that this should run on any OS.

## How to try it

I haven't tested it at all yet outside of my personal machine, but as long as you have Node and npm installed, you should be able to:

- Install the dependencies with `npm install`
- run the application with `npm run dev`

