# Lambdalet

create bookmark
browser.bookmarks.create({
  title: "bookmarks.create() on MDN",
  url: "https://developer.mozilla.org/Add-ons/WebExtensions/API/bookmarks/create",
})

## About

Lambdalet (*Lambda* + ~~bookmark~~*let*) is a DIY bookmarking and read-it-later service. 
It consists of a [bookmarklet](https://en.wikipedia.org/wiki/Bookmarklet) that invokes a Lambda function with the current page's content and URL. The Lambda function uses an LLM to extract the pages' main content and saves it to a Notion database.

## Try It

You can try it without deploying anything. Just follow the steps below:

1. Open my shared [Notion database](https://www.notion.so/zirkelc/20c00d5ef00e802a8cd1de77eafebc4f?v=20c00d5ef00e80c8adb5000cca955976&p=20d00d5ef00e81029accc1ca2b4888d0&pm=s). All bookmark are saved into this database.

2. Create a new bookmark in your browser with the following URL:

```js
javascript: (async () => { 
  const response = await fetch("https://paip1r3t7j.execute-api.eu-west-1.amazonaws.com/prod/", {
    method: "POST",
    body: JSON.stringify({
      html: document.body.innerHTML,
      url: window.location.href,
      title: document.title,
    }),
    headers: {
			'content-type': 'application/json',
			'x-api-key': 'W76GK763928L8g8TcMdMU8Dw2rQ4EZwv3eqf4Yp0',
    },
  });  
  alert("sent"); 
  void 0 
}
)();
```

3. Open a page of your interest, for example [Invoking a Lambda function using an Amazon API Gateway endpoint](https://docs.aws.amazon.com/lambda/latest/dg/services-apigateway.html).

4. Click on the bookmark you created.

5. Check the Notion database from the first step. You should see a new entry for your page. The content extraction runs asynchronously, so it may take a few seconds to minutes until the content appears, depending on the page's size.

> [!NOTE]
> If a page with the same URL already exists in the database, the content will be updated.


## Architecture




## Development
The following steps describe hwo you can set up your own instance of the app. A AWS account and Notion workspace are required.

### Create a Notion page and database

Create a new Notion page via the Notion app and then create a new full-page database within this page. Note that you cannot create top-level databases in the Notion app, but you can move the database out of the page to be top-level. The database properties are automatically initialized on the first run. Take a note of the database ID that you can find in the URL of the database page.

[![Notion database ID](https://files.readme.io/64967fd-small-62e5027-notion_database_id.png)](https://developers.notion.com/reference/retrieve-a-database#:~:text=To%20find%20a%20database%20ID%2C%20navigate%20to%20the%20database%20URL%20in%20your%20Notion%20workspace.%20The%20ID%20is%20the%20string%20of%20characters%20in%20the%20URL%20that%20is%20between%20the%20slash%20following%20the%20workspace%20name%20(if%20applicable)%20and%20the%20question%20mark.%20The%20ID%20is%20a%2032%20characters%20alphanumeric%20string)

### Create an internal Notion integration

Go to the [Notion integrations](https://www.notion.so/profile/integrations) and create a new internal integration for your workspace. Take a note of the internal integration secret. On the access tab, you need to allow the integration to access the database you created in the previous step.

### Environment variables

Rename the [`.env.template`](./.env.template) file to `.env` and fill the variables with the values you obtained in the previous steps.

### Deploy project

Clone the repository and install the dependencies. Then run the `deploy` script to deploy the project. Take a note of the API Gateway URL and API key ID output.

```bash
pnpm install
pnpm deploy
```

### Create a bookmarklet

Use the existing [bookmarklet](./bookmarklet.js) as template and replace the URL and API key with the values from the deployed project. To get the actual API key, you need to go to the API Gateway console, select the API key ID and click on the "Show" button.


## Issues and Limitations

The bookmarklet runs in the context of the current page. If the current page has a [Content Security Policy (CSP)](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP), the `fetch` call might be blocked. Check the browser console for errors.



## Future Ideas

- Use an LLM to create a summary of the pages' content.
- Save page's content to other apps like Obsidian or Roam Research.