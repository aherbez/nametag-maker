# Mammal Tag

![tag making app](/docs/hat_tag_app.png)

## The problem

I recently visited the Marine Mammal Center in Sasaulito for the first time, and learned that they use 3d printed "hat tags" to tell the seals in their care apart. This is important because seals can look very similar, but each one has their own specific dietary and treatment needs.

Here's an example of the tags in use:

![seal with hat tag](/docs/hat_tag.png)

Image source (and more information) [here](https://www.marinemammalcenter.org/news/new-hat-tags-improve-animal-care-while-leading-the-way-toward-a-greener-future)

## The why

I tend to think that the world needs more hyper-specialized CAD tools. There are tons of people and processes that could benefit from customized 3d models, but actually using CAD tools is a huge ask. Much better to have tools that provide only the options that are strictly necessary.

This tool allows the user to specify the following (all dimensions in millimeters):

- the base plate's depth and thickness (defaults: 30 × 4); its width is calculated from the image, the name and the margins
- the corner radius and the fillet on the plate's top edges
- an SVG image, placed at the left side of the plate, and the font for the name (both chosen under File → Settings…, and copied into the app's storage)
- a name, placed to the right of the image
- how far the image and name are raised above the plate
- the diameter and depth of two magnet pockets in the bottom (made 0.4 mm wider than the magnet for a press fit)
- the image size (it shrinks automatically if it doesn't fit); the name is scaled to fill the plate's depth, inside the margin

It creates a 3d model of a rounded, filleted plate with the image and name raised on top, and allows the user to download the result as a 3d printable STL file.

To make a batch, use File → Load CSV… with a list of names (each cell is one name). The tags are packed onto print beds of the size set in File → Settings…, and saving writes one STL per bed (`<name>_1.stl`, `<name>_2.stl`, …).

## The how

This is implemented as an Electron app, using typescript, React, and the MUI library and for the 3d, I'm using ThreeJS for the rendering and camera control.

But the real magic / heavy lifting is thanks to [opencascadejs](https://ocjs.org/), the WASM port of the [OpenCascade](https://dev.opencascade.org/) open-source CAD kernel. This means that the app can do actual, proper CAD operations, like filleting edges, and output proper clean geometry.

I went with webtech + Electron both because I love webtech, but also because it means that this should run on any OS.

## How to try it

I haven't tested it at all yet outside of my personal machine, but as long as you have Node and npm installed, you should be able to:

- Install the dependencies with `npm install`
- run the application with `npm run dev`

