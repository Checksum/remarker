# Remarker

A simple annotation processor for JavaScript.

### Usage

1) Include the following somewhere in your html page

```html
<script src="lib/acorn.js"></script>
<script src="lib/walk.js"></script>
<script src="remarker.js"></script>
```

2) Prepare your JS source and a list of annotation handlers

```js
var source = document.getElementById("script1").innerHTML, 
var handlers = {
	Info: function(block) {},
	Assert: function(block) {}
}
```

3) Do the magic!

```js
Remarker.process(source, handlers);
```

### Caveat Emptor

This is still proof of concept, so only a limited use cases are supported. You can **only**

* Annotate functions with a defined context (no anonymous/function within a function)
* Does not work with strict mode because we need to access arguments.callee
* Currently, only **one* annotation per function
* For an entire list of supported syntax, please check demo/index.html

### Credits

Uses the awesome [acorn](https://github.com/marijnh/acorn) JavaScript parser


### License

Released under the permissive MIT license.

