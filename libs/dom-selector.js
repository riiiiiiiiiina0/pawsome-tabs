// https://github.com/sagarchauhan005/domElementHighlighter
(function (window, document) {
  // @ts-ignore - Adding domElementHighlighter to window
  window.domElementHighlighter = (function (window, document) {
    let inspector;
    let srcElement;
    let gTop, gLeft, gHeight, gWidth;
    let callbackFunction = null;

    /*
     * Options value for the highlighter
     * */
    const opt = {
      elemId: 'domElementHighlighter',
      visible: 'domElementHighlighterVisible',
      closeBtnContainer: 'domCloseHighlighterCont',
      closeBtn: 'domCloseHighlighterBtn',
      highlightStyle:
        '.domElementHighlighterVisible {box-shadow : 0 0 0 9999px rgba(0, 0, 0, 0.5);} #domCloseHighlighterCont{display:none; top: 20px ; position: fixed; color: white; right: 52px; cursor: pointer; font-size: 25px !important; line-height:0; background-color: rgba(0, 0, 0, 0.8) !important; border-radius:10px !important;}',
      border: '2px solid red',
      transitionSpeed: 50,
      ignoreElem: ['head', 'meta', 'link', 'style', 'title', 'script'], // elements to ignore
    };

    /*
     * Inject style to page
     * */
    const addStyle = function (styles) {
      const css = document.createElement('style'); /* Create style document */
      css.type = 'text/css'; //couldn't find its alternative, despite it being deprecated
      // @ts-ignore - Legacy IE support for styleSheet
      if ('styleSheet' in css && css.styleSheet)
        css.styleSheet.cssText = styles;
      else css.appendChild(document.createTextNode(styles));
      const head = document.getElementsByTagName('head')[0];
      if (head) {
        head.appendChild(css); /* Append style to the tag name */
      }
    };

    /*
     * Define all the events
     * */
    const events = {
      click: 'click',
      mouseover: 'mouseover',
      mouseenter: 'mouseenter',
      mouseup: 'mouseup',
      mouseleave: 'mouseleave',
      mousedown: 'mousedown',
      keyUp: 'keyup',
    };

    /*
     * Actions to take
     * */
    const actions = {
      start: 'start',
      stop: 'stop',
    };

    /*
     * Search query for DOM elements
     * */
    const getQuery = function () {
      let query = '*';
      const ignore = opt.ignoreElem;
      const ignoreLen = ignore.length;
      if (ignoreLen) {
        // add ignore elements into query
        for (let i = 0; i < ignoreLen; i++) {
          query += `:not(${ignore[i]})`;
        }
      }
      return query;
    };

    /*
     * Prepares inspector design attributes, dynamically
     * */
    const getInspectorDesign = function (top, left, width, height) {
      return (
        `transition : all ${opt.transitionSpeed}ms;` +
        `top :${top || 0}px;` +
        `left :${left || 0}px;` +
        `width : ${width || 0}px;` +
        `height: ${height || 0}px;` +
        'pointer-events : ' +
        'none !important;' +
        'cursor : ' +
        'pointer;' +
        'z-index : 2147483647;' +
        'position :absolute;' +
        `border : ${opt.border}`
      );
    };

    /*
     * Closes the highlighted element
     * */
    const closeHighlight = function () {
      document.removeEventListener(events.mouseover, freezeDomEvent, true);
      document.removeEventListener(events.click, handleCloseClick, true);
      const elemHighlighter = document.getElementById(opt.elemId);
      if (elemHighlighter) {
        elemHighlighter.classList.remove(opt.visible);
      }
      const closeBtnContainer = document.getElementById(opt.closeBtnContainer);
      if (closeBtnContainer) {
        closeBtnContainer.style.display = 'none';
      }
    };

    /*
     * Stops the selector and cleans up
     * */
    const stop = function () {
      attachListeners(actions.stop);
      document.removeEventListener(events.keyUp, keyPress);
      const inspectorElement = document.getElementById(opt.elemId);
      if (inspectorElement) {
        inspectorElement.remove();
      }
      callbackFunction = null;
    };

    /*
     * Sets up the inspector and its all its actions
     * */
    const setUpInspector = function () {
      inspector = document.createElement('div'); // inspector elem
      inspector.id = opt.elemId;
      inspector.style = getInspectorDesign(); // get inspector design
      const body = document.getElementsByTagName('body')[0];
      if (body) {
        body.prepend(inspector); // append to body
      }

      const inspectorOverlay = document.createElement('div'); // inspector elem
      // used important in styling to override the p style tag in different website as this message wasn't visible
      inspectorOverlay.innerHTML =
        '<p style="color:white !important; font-size: 25px !important; padding: 20px 20px 6px 20px !important;">Press Esc to close</p>';
      inspectorOverlay.id = opt.closeBtnContainer;
      const elemHighlighter = document.getElementById(opt.elemId);
      if (elemHighlighter) {
        elemHighlighter.append(inspectorOverlay); // append to body
      }

      addStyle(opt.highlightStyle);
    };

    /*
     * gets the dimensions of the clicked element
     * */
    const getDimensions = function (event) {
      const { target } = event; // active node
      if (target.id === opt.elemId) return; // ignore itself

      const pos = target.getBoundingClientRect(); // get information
      const scrollTop = window.scrollY || document.documentElement.scrollTop; // get Scroll
      const { width } = pos;
      const { height } = pos;
      const top = Math.max(0, pos.top + scrollTop);
      const { left } = pos;

      return {
        width: width,
        height: height,
        top: top,
        left: left,
      };
    };

    /*
     * Event handlers
     * */
    const eventEmitter = function (event) {
      let dimensions = getDimensions(event);
      if (!dimensions) return; // return early if no dimensions

      gWidth = dimensions.width;
      gTop = dimensions.top;
      gHeight = dimensions.height;
      gLeft = dimensions.left; // for checking click in highlighted element while closing
      const inspectorStyles = getInspectorDesign(
        dimensions.top,
        dimensions.left,
        dimensions.width,
        dimensions.height,
      ); // get inspector style
      inspector.setAttribute('style', inspectorStyles); // assign the style
    };

    /*
     * Freezes any action on event
     * */
    let freezeDomEvent = function (e) {
      e.stopPropagation();
      e.preventDefault();
    };

    /*
     * Gets the CSS selector for the element and optionally logs it
     * */
    const getCssSelectorShort = function (element) {
      var elementId = element.id;

      // Stop if an id is found, those are unique.
      if (elementId) {
        return '#' + elementId;
      }

      var selector = [];
      var cl, name;
      while (
        element.parentNode &&
        (selector.length === 0 ||
          document.querySelectorAll(selector.join(' ')).length !== 1)
      ) {
        // if exist, add the first found id and finish building the selector
        var id = element.getAttribute('id');
        if (id) {
          selector.unshift('#' + id);
          break;
        }

        cl = element.getAttribute('class');
        cl = cl ? '.' + cl.trim().replace(/ +/g, '.') : '';
        name = element.getAttribute('name');
        name = name ? '[name=' + name.trim() + ']' : '';
        selector.unshift(element.localName + cl + name);
        element = element.parentNode;
      }

      var result = selector[0];
      if (selector.length > 1) {
        result +=
          ' > ' +
          selector
            .slice(1)
            .join(' > ')
            .replace(/\[name=[^\]]*]/g, '');
      }

      return result;
    };

    /*
     * Handles the overlay close
     * */
    const handleCloseClick = function (event) {
      let nDimensions = getDimensions(event);
      if (!nDimensions) return; // return early if no dimensions

      if (
        gTop !== nDimensions.top &&
        gLeft !== nDimensions.left &&
        gHeight !== nDimensions.height &&
        gWidth !== nDimensions.width
      ) {
        closeHighlight();
      }
      event.stopPropagation();
      event.preventDefault();
    };

    /*
     * Highlights the active element
     * */
    const highlightActiveElem = function (e) {
      srcElement = e.srcElement;
      const closeBtnContainer = document.getElementById(opt.closeBtnContainer);
      if (closeBtnContainer) {
        closeBtnContainer.style.display = 'block';
      }
      const elemHighlighter = document.getElementById(opt.elemId);
      if (elemHighlighter) {
        elemHighlighter.classList.add(opt.visible);
      }
      document.addEventListener(events.mouseover, freezeDomEvent, true);
      document.addEventListener(events.click, handleCloseClick, true);
      const selector = getCssSelectorShort(srcElement); // Get the unique css selector

      // Call callback with selector and stop the selector
      if (callbackFunction && typeof callbackFunction === 'function') {
        callbackFunction(selector);
        stop();
      }

      e.stopPropagation();
      e.preventDefault();
    };

    /*
     * Clones each element onto itself to remove any default handlers
     * */
    const cloneElem = function (elem) {
      // Check if element has a parent node before attempting to replace
      if (!elem.parentNode) {
        return elem;
      }
      const new_element = elem.cloneNode(true);
      elem.parentNode.replaceChild(new_element, elem);
      return new_element;
    };

    /*
     * Listener function for keypress
     * */
    const keyPress = function (e) {
      if (e.key === 'Escape') {
        closeHighlight();

        // Call callback with empty string when user aborts and stop the selector
        if (callbackFunction && typeof callbackFunction === 'function') {
          callbackFunction('');
          stop();
        }
      }
    };

    /*
     * Attaches listener to DOM
     * */
    const attachListeners = function (type) {
      const query = getQuery();
      const allNodes = document.querySelectorAll(query);
      for (let i = 0; i < allNodes.length; i++) {
        // loop each node to bind the listener
        const elem = allNodes[i];
        if (type === actions.stop) {
          elem.removeEventListener(events.mouseover, eventEmitter);
          elem.removeEventListener(events.click, highlightActiveElem);
        } else if (type === actions.start) {
          elem.addEventListener(events.mouseover, eventEmitter);
          elem.addEventListener(events.click, highlightActiveElem);
        }
      }

      if (type === actions.stop) {
        // removes the keyup listener
        document.removeEventListener(events.keyUp, keyPress);
      }
    };

    /*
     * Initiate removing of all default handlers
     * */
    const removeDefaultHandlers = function () {
      const query = getQuery();
      const allNodes = document.querySelectorAll(query);
      for (let i = 0; i < allNodes.length; i++) {
        // loop each node to bind the listener
        cloneElem(allNodes[i]);
      }
    };

    /*
     * Handles close action
     * */
    const handleCloseByEscape = function () {
      document.addEventListener(events.keyUp, keyPress);
    };

    /*
     * Initializing the plugin
     * */
    const init = function (type, callback) {
      // Store the callback function
      callbackFunction = callback;

      // initiate the library
      const action = type ? actions.start : actions.stop;
      // Skip removeDefaultHandlers() to prevent page flashing and element loss
      // removeDefaultHandlers();
      setUpInspector();
      attachListeners(action);
      handleCloseByEscape();
    };

    /*
     * expose the functions
     * */
    return {
      init,
      stop,
    };
  })(window, document);
})(window, document);
