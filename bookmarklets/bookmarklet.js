javascript: (async () => {
  const apiKey = 'W76GK763928L8g8TcMdMU8Dw2rQ4EZwv3eqf4Yp0';
  const apiUrl = 'https://paip1r3t7j.execute-api.eu-west-1.amazonaws.com/prod/';
  const url = `${apiUrl}?apiKey=${apiKey}`;

  function getSelectedHTML() {
    if (window.getSelection) {
      const selection = window.getSelection();
      if (selection.rangeCount) {
        const container = document.createElement('div');
        for (let i = 0; i < selection.rangeCount; ++i) {
          container.appendChild(selection.getRangeAt(i).cloneContents());
        }
        return container.innerHTML;
      }
    }
    if (document.selection && document.selection.type === 'Text') {
      return document.selection.createRange().htmlText;
    }

    return undefined;
  }

  const selectedHTML = getSelectedHTML();
  const hasSelection = !!selectedHTML;

  const data = {
    html: hasSelection ? selectedHTML : document.body.innerHTML,
    mode: hasSelection ? 'selection' : 'document',
    url: window.location.href,
    title: document.title,
  };

  try {
    await fetch(url, {
      method: 'POST',
      body: new FormData({
        ...data,
        invoke: 'fetch',
      }),
    });
  } catch (error) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.target = '_blank';
    document.body.appendChild(form);

    Object.entries({
      ...data,
      invoke: 'form-blank',
    }).forEach(([key, value]) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = value;
      form.appendChild(input);
    });

    form.submit();

    document.body.removeChild(form);
  }
  alert(`Saved ${hasSelection ? 'text selection' : 'full page'} to Lambdalet.AI`);
})();