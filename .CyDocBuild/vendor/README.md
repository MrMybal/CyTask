# CyDoc build dependency

CyDoc 0.1.0, MIT licensed, built from Git commit
6ddf9a582defb2f11fbb3f992afef6f98dcadc93 of https://github.com/MrMybal/CyDoc.

The application archive retains the upstream compiled runtime, compiler tools,
viewer templates and license without changing their contents. Upstream demo
generators, developer guides and integration samples are not part of this build
dependency. Its lockfile pins the archive integrity; builds do not need access to
the private Git repository.
Only the image and gallery readers are selected for the CyTask export.
No Three.js dependency is installed in this application package.

To reproduce, build the documented revision with npm ci and npm run build, then
run node .CyDocBuild/vendor-package.mjs path/to/built/CyDoc from
CyTask. The script packages a separate staging copy, never the upstream source.
After an update, regenerate both documentation and Web package lockfiles.
Keep the upstream license and dependency notices in every distributed manual.
