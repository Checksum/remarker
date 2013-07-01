/*
 * Remarker.js - A simple JavaScript Annotation Processor
 * http://github.com/Checksum/remarker
 *
 * Copyright (c) 2013 Srinath
 * Licensed under the MIT license.
 * https://github.com/Checksum/remarker/blob/master/LICENSE
 */

(function(exports, acorn) {

    var source,
        annotatedLines,
        annotationBlocks,
        lastIndex,
        
        // Util functions
        trim = function(text) {
            return text.replace(reWhitespaceTrim, '');
        },
        merge = function(src, dest) {
            Object.keys(src).forEach(function(key) {
                dest[key] = src[key];
            });
            return dest;
        },
        getFunctionContext = function(ctx, ctxArray) {
            var obj;
            ctx = typeof ctx === "string" ?
                    (typeof window[ctx] !== "undefined" ? window[ctx] : window) 
                        : ctx;

            if (typeof ctxArray === "string") {
                ctxArray = [ctxArray];
            }
            while (ctxArray.length > 1) {
                obj = ctxArray.shift();
                if (typeof ctx[obj] !== 'undefined') {
                    ctx = ctx[obj];
                }
            }

            // The last entry is the function name that we need to be checking
            return { 
                context: ctx, 
                name: ctxArray[0], 
                isFunction: typeof ctx[ctxArray[0]] === 'function'
            };
        },
        
        // Regular Expressions
        // Match an annotation parameter within ({})
        reAnnotationParam = /\(({.*?})\)/,
        // Matches a whole line break (where CRLF is considered a single
        // line break). Used to count lines. (From acorn.js)
        reLineBreak = /\r\n|[\n\r\u2028\u2029]/g,
        // Multiline comment cleanup
        reMultilineTrim = /\r\n\s*|[\n\r\u2028\u2029]\s*/g,
        // Simple starting and ending trim
        reTrimSource = /^\n|\n$/,
        // Trim whitespace
        reWhitespaceTrim = /^\s+|\s+$/g;

    // Our app
    var Remarker = exports.Remarker = {};
    
    // @param - JS source as string
    // @param - annotation handlers as { Annotation: handlerFunction }
    Remarker.process = function(src, handlers) {
        var ast, handler;
        // Initialize internal state
        annotatedLines = [];
        annotationBlocks = [];
        lastIndex = 0;
        // Cleanup source
        source = src.replace(reTrimSource, '');
        // We have a set of default annotation handlers
        handlers = merge(DefaultHandlers, handlers || {});
        // Construct AST.
        // At this step, when a comment is encountered, we
        // call the annotationProcessor to determine all the
        // annotation blocks and the lines in which they occur
        ast = acorn.parse(source, {
            onComment: Remarker.annotationProcessor
        });
        // We now walk through the ast to determine which declarations
        // are annotated and try to determine the context and function
        // for each declaration
        acorn.walk.simple(ast, Remarker.astWalker);

        // Now invoke the handlers for the annotated functions
        annotationBlocks.forEach(function(block) {
            handler = handlers.hasOwnProperty(block.annotation) ?
                handlers[block.annotation] : handlers.Info;
            // Invoke the handler
            handler(block);
        });

        return ast;
    };

    // This is a modified version of getLineInfo from acorn.js
    // which always starts from index 0 of the source string.
    // If lastIndex is set, the regex starts matching from that
    // index instead of the beginning of the string
    // This gives a nice little performance boost :)
    Remarker.getLineInfo = function(source, offset) {
        var line = 1,
            cur = lastIndex,
            match;

        for (;;) {
            reLineBreak.lastIndex = cur;
            match = reLineBreak.exec(source);
            if (match && match.index < offset) {
                ++line;
                cur = this.lastIndex = match.index + match[0].length;
            } 
            else {
                break;
            }
        }
        return {line: line, column: offset - cur};
    };

    // Handler for onComment block. Invoked by acorn when a comment is
    // encountered
    Remarker.annotationProcessor = function(block, text, start, end) {
        var annotation, params, line;
        if (block) {
            text = text.replace(reMultilineTrim, '');
        }
        text = trim(text);
        // Our first character should be a '@'
        if (text[0] === '@') {
            // Annotation
            annotation = text.substring(1);
            // If annotation has params, extract params
            params = text.match(reAnnotationParam);
            if (params) {
                params = JSON.parse(params[1]);
                annotation = annotation.replace(reAnnotationParam, '');
            }
            // Get line number
            // Our actual block is the next line
            line = acorn.getLineInfo(source, end).line + 1;
            // Keep track of the annotated line
            annotatedLines.push(line);
            // And other annotation details
            annotationBlocks.push({
                line: line,
                annotation: annotation,
                params: params || {}
            });
        }
    };

    Remarker.astWalker = {
        // For function hey() {} style declaration
        FunctionDeclaration: function(node) {
            var line = acorn.getLineInfo(source, node.start).line,
                fnName,
                index;
            // If the line is to be annotated
            if ((index = annotatedLines.indexOf(line)) !== -1) {
                // Get function name
                fnName = node.id.name;
                annotationBlocks[index].fn = {
                    context: window,
                    name: fnName
                };
            }
        },

        // For Parent.fun = function() {} style declaration
        MemberExpression: function(node) {
            var line = acorn.getLineInfo(source, node.start).line,
                ctxArray,
                ctxObj,
                ctx = window,
                index,
                getContextRecursive = function(node, ctxArray) {
                    if (node.object.object) {
                        getContextRecursive(node.object, ctxArray);
                    }
                    if (node.object.name) {
                        ctxArray.push(node.object.name);
                    }
                    if (node.property) {
                        ctxArray.push(node.property.name);
                    }
                    else if (node.object.property) {
                        ctxArray.push(node.object.property.name);
                    }
                    return ctxArray;
                };

            // If the function has been annotated,
            if ((index = annotatedLines.indexOf(line)) !== -1) {
                // For declarations like stat.sensor1.reading1.show = function() {}
                // the ast will have multiple MemberExpression declarations.
                // In this case, we will need only the last declaration which
                // has an entire list of the function and its parent objects.
                // But since we will not have the list beforehand, for every MemberExpression
                // we build the context and test if context[fnName] is a function. As it will
                // be true for functions, our purpose is solved :)
                ctxArray = getContextRecursive(node, []);
                //
                ctxObj = getFunctionContext(ctx, ctxArray);
                if (ctxObj.isFunction) {
                    annotationBlocks[index].fn = ctxObj;
                }
            }
        },
        // All function calls
        // Calls of the type obj.member() are also captured as
        // MemberExpression. So we need to handle only those of kind
        // function(). If the annotation has already been processed, do nothing
        CallExpression: function(node) {
            var line = acorn.getLineInfo(source, node.start).line,
                index = annotatedLines.indexOf(line);
            // Check if the node has already been processed
            if (index !== -1 && typeof annotationBlocks[index].fn === "undefined") {
                annotationBlocks[index].fn = {
                    context: window,
                    name: node.callee.name
                };
            }
        },
        // Unfortunately, there is no easy way to determine the function declaration
        // for member variables without walking the whole node. 
        // For ex, var obj = { fn: function() {} } will have to parsed completely to
        // determine if fn is annotated.
        VariableDeclaration: function(node) {
            var i,
                len,
                decl,
                ctxArray = [],
                tempArray,
                annotatedMembers = [],
                ctx,
                ctxObj,
                index,
                line,
                getContextRecursive = function(node, ctxArray) {
                    if (node.key.name) {
                        ctxArray.push(node.key.name);
                    }
                    if (typeof node.value.properties !== 'undefined') {
                        for (var i = 0, len = node.value.properties.length; i < len; i += 1) {
                            // If there are multiple properties, each one needs
                            // a copy of the context. So make a copy into tempArray
                            tempArray = ctxArray.slice(0);
                            // And for each property, get the context recursively
                            getContextRecursive(node.value.properties[i], tempArray);
                        }
                    }
                    // If function declaration, check if it annotated
                    if (node.value.type === 'FunctionExpression') {
                        line = acorn.getLineInfo(source, node.value.start).line;
                        if (annotatedLines.indexOf(line) !== -1) {
                            annotatedMembers.push({
                                line: line,
                                ctxArray: ctxArray
                            });
                        }
                    }
                    return ctxArray;
                };

            // There can be multiple declarations inside an object, which are
            // part of the node.declarations array. Walk this recursively
            for(i = 0, len = node.declarations.length; i < len; i += 1) {
                decl = node.declarations[i];
                if (decl.type === "VariableDeclarator") {
                    // node->id->name (type "Identifier") (Main Object)
                    // node->init->properties[] (type "ObjectExpression")
                    // properties[i]->key->name (type "Identifier") (property name)
                    // properties[i]->value (function body) (type "FunctionExpression")
                    if (decl.id.type === "Identifier") {
                        // This is our first level object
                        ctx = decl.id.name;
                    }
                    // If there are multiple property declarations
                    if (typeof decl.init.properties !== 'undefined') {
                        decl.init.properties.forEach(function(prop) {
                            ctxArray = getContextRecursive(prop, []);
                        });
                    }
                    else if (decl.init.type === "FunctionExpression") {
                        line = acorn.getLineInfo(source, decl.init.start).line;
                        annotatedMembers.push({
                            line: line,
                            ctxArray: ctx
                        });
                    }
                }
            }
            // Construct the context and function name for each of the members
            annotatedMembers.forEach(function(obj) {
                ctxObj = getFunctionContext(ctx, obj.ctxArray);
                index = annotatedLines.indexOf(obj.line);
                if (ctxObj.isFunction) {                    
                    annotationBlocks[index].fn = ctxObj;
                }
                else {
                    annotatedLines.splice(index, 1);
                    annotationBlocks.splice(index, 1);
                }
            });
        }
    };

    // So what exactly is the point of all this?
    // Here are some useful annotations which you can use
    var DefaultHandlers = {
        // Default annotation handler which simply logs info into console
        Info: function(block) {
            console.log(["Annotation", block.annotation,
                "at line", block.line,
                "for function", block.fn.name
            ].join(" "));
        },
        // Instrument a function by hooking before and after calls
        // to a custom function
        Instrument: function(block) {
            var context = block.fn.context, 
                fnName = block.fn.name,
                originalFn = context[fnName],
                executeCallback = function(fn, args) {
                    var ctxObj;
                    if (fn) {
                        // If function is Obj1.fn.fn1
                        fn = fn.split(".");
                        ctxObj = getFunctionContext(window, fn);
                        if (ctxObj.isFunction) {
                            // You can access the annotation details from within
                            // the function
                            ctxObj.context.__annotation = block;
                            return ctxObj.context[ctxObj.name].apply(ctxObj.context, args);
                        }
                    }
                };

            // Override the function in the
            context[fnName] = function instrumented() {
                // If called directly from window context, invokingFn will be null
                var returnVal,
                    invokingFn = arguments.callee.caller,
                    invokingFnName = invokingFn ? 
                        (invokingFn.name ? invokingFn.name : 'Anonymous') : 'Window';
                // Convert the arguments list into an array so that we
                // can add a few more arguments to it
                // args = Array.prototype.slice.call(arguments);
                // For now, we are adding only the invoking name as the third argument
                // args.push(invokingFnName);
                
                // Before hook
                executeCallback(block.params.before, arguments);
                // Call the original function
                returnVal = context[fnName]._instrumented.apply(this, arguments);
                // After hook
                executeCallback(block.params.after, arguments);
                // Return the value from the original function
                return returnVal;
            };
            context[fnName]._instrumented = originalFn;
        }
    };

}(this, window.acorn));

