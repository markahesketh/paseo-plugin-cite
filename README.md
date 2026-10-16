# Paseo Cite

Add inline review comments to Paseo assistant messages.

Select part of an assistant reply, choose **Cite**, write a comment, and submit it. Paseo Cite adds the citation to the composer as a native attachment. This gives you a focused way to ask about one claim, correct one detail, or request a change to one part of an answer.

## What it does

- Shows a `Cite` action when you select conversation text.
- Opens a comment form that matches Paseo's review UI in light and dark mode.
- Submits with `Enter`.
- Inserts a new line with `Shift+Enter` or `Alt+Enter`.
- Cancels with the **Cancel** button, `Escape`, or an outside click.
- Adds each citation to the composer as its own attachment, so you can remove each one separately.
- Shows a short form of the comment and the quote on each attachment.
- Prevents duplicate citations.
- Scrolls to and highlights the cited text when you select a citation attachment, or press `Enter` on it, and opens its comment for editing.
- Copies the formatted citation when it cannot add the citation to the composer.

## Requirements

- Paseo `>=0.11.0`.
- Paseo desktop or web client.
- Plugins enabled in Paseo.

The plugin does not show the citation action on iOS or Android. Paseo does not expose the browser selection and composer attachment surfaces required by this plugin on those platforms.

## Install

Install the plugin from its directory on the machine running the Paseo daemon:

```sh
paseo plugin install /absolute/path/to/paseo-plugin-cite
paseo plugin ls
```

The plugin should report `running`. Enable plugins in Paseo settings before installation if they are disabled.

After installation, open or reload the Paseo client. Start a new conversation if an existing conversation still has the old client bundle.

## Use

1. Select text in an assistant reply.
2. Select **Cite**.
3. Enter the comment.
4. Press `Enter` or select **Comment**.
5. Continue writing your message in the composer.
6. Submit the message normally.

The composer shows one card for each citation. The card shows the start of your comment, with the start of the quote below it:

```text
Check this claim again
Citation “The cache is cleared on each…”
```

Select a card, or focus it and press `Enter`, to scroll to and highlight its cited text in the current conversation. The comment form opens with the full quote and the current comment. Change the comment and press `Enter` or select **Save**. The card stays in the same position. Press `Escape` or select **Cancel** to close the form with no change. If the cited text is no longer in the conversation, the form opens above the card.

Remove a card to remove only that citation.

The text sent with each citation has this form:

```text
[Citation from this conversation]
> selected text

Comment:
your comment
```

The attachment holds this text and nothing else. The plugin reads the quote and comment back from it, so a restored draft keeps its citations.

## Known limitations

### Queued messages

Paseo preserves the citation attachment when a message is queued, but its queue row displays only the message text. The citation can therefore be hidden in the queue until Paseo renders queued attachments. The plugin does not add fake text to the prompt to work around this, because that would change the message sent to the agent.

### Web composer integration

Paseo does not currently expose a public API for adding an arbitrary attachment to the active composer from a selection event. The plugin therefore uses a small web-only bridge to Paseo's existing composer attachment setter. A Paseo UI change can require an update to this bridge.

### Selecting text

The action is available for any selectable text outside the composer, so use it on assistant replies. Selecting a card searches only that card's conversation, not the sidebar or other panes. If the quote appears more than once, the occurrence nearest the composer is used. If the cited text is no longer in the conversation when you select its card, the plugin shows "Could not find the cited text in this conversation." and still opens the comment for editing.

### Fallback mode

If the composer bridge is missing, Paseo rejects the attachment update, or no composer can be found, the plugin copies the formatted citation and shows a message so you can paste it into the composer.

## Development

Clone the repository, install the development dependencies, and run the checks:

```sh
npm ci
npm run typecheck
npm test
```

To use the working tree as a Paseo plugin:

```sh
paseo plugin install /absolute/path/to/paseo-plugin-cite
paseo plugin reload paseo-cite
```

The test suite covers citation formatting, quote and comment content that looks like the format, size limits, one attachment for each citation, restored attachments, the card text, in-place edits, the copy fallback and a copy that finishes late, the committed React fiber lookup against React DOM, attachment updates the composer has not rendered yet, finding a cited quote in its own conversation, the Enter key decision, and the cite button, comment edit, keyboard, and close flows against jsdom and React DOM, including one overlay shared by two plugin bundle copies.

## Project layout

```text
.
├── client/
│   ├── citation-attachment.ts        Citation composer attachment model
│   ├── citation-attachment.test.mjs  Attachment tests
│   ├── citation-format.ts            Citation model and text format
│   ├── citation-format.test.mjs      Formatting tests
│   ├── react-fiber.ts                Committed React fiber lookup for the composer bridge
│   ├── react-fiber.test.mjs          Fiber lookup tests against React DOM
│   └── web/                          Web-only code, compiled with the DOM lib
│       ├── composer-bridge.ts        Paseo composer selectors, lookup, and attachment bridge
│       ├── composer-bridge.test.mjs  Attachment bridge tests against React DOM
│       ├── overlay.ts                Overlay state and events, shared between plugin bundle copies
│       ├── overlay.test.mjs          Overlay tests against jsdom
│       ├── overlay-view.ts           Cite button, comment form, toast, and highlight elements and styles
│       ├── text-range.ts             Selection reading and quote search in the conversation
│       └── text-range.test.mjs       Quote search tests against jsdom
├── test/
│   └── resolve-ts.mjs                Node import hook for TypeScript imports
├── index.client.tsx                  Paseo client entry point
├── paseo-plugin.json                 Paseo plugin manifest
├── package.json                      Development scripts and SDK versions
├── tsconfig.json                     Strict, DOM-free TypeScript configuration
└── tsconfig.web.json                 The same, with the DOM lib, for the web code
```

Only `client/web/` and `index.client.tsx` are compiled with the DOM lib. Only `client/web/` touches browser APIs, and only `client/web/composer-bridge.ts` relies on Paseo's private composer DOM and React props. The rest of the plugin remains compatible with Paseo's client bundle rules.

## Contributing

Before opening a change, run:

```sh
npm run typecheck
npm test
```

Keep changes web-only when they depend on `window` or `document`, preserve the native Paseo attachment renderer, and test each new behavior at the lowest level that can detect a regression.
