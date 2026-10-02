# Paseo Cite

Add inline review comments to Paseo assistant messages.

Select part of an assistant reply, choose **Cite**, write a comment, and submit it. Paseo Cite adds the citation to the composer as a native attachment. This gives you a focused way to ask about one claim, correct one detail, or request a change to one part of an answer.

## What it does

- Shows a `Cite` action when you select conversation text.
- Opens a comment form that matches Paseo's review UI in light and dark mode.
- Submits with `Enter`.
- Inserts a new line with `Shift+Enter` or `Alt+Enter`.
- Cancels with the **Cancel** button, `Escape`, or an outside click.
- Adds the citation to the composer as a `Citation` attachment with a comment count.
- Combines several citations into one composer attachment.
- Prevents duplicate citations.
- Scrolls to and highlights the cited text when you select the citation attachment. Each further selection goes to the previous citation.
- Copies a formatted citation when the composer attachment bridge is unavailable.

## Requirements

- Paseo `>=0.9.1`.
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

The composer shows one citation card. Its count increases when you add more citations:

```text
Citation
2 comments
```

Select the card to scroll to and highlight the most recently added citation in the current conversation. Select it again to go to the previous citation. After the first citation, it goes back to the latest one.

The text sent with each citation has this form:

```text
[Citation from this conversation]
> selected text

Comment:
your comment
```

The plugin stores citation entries as structured data inside the composer attachment and keeps the formatted text as a compatibility snapshot for the agent. It still reads text that uses the earlier `[Citation from your previous answer]` header.

## Known limitations

### Queued messages

Paseo `0.9.1` preserves the citation attachment when a message is queued, but its queue row displays only the message text. The citation can therefore be hidden in the queue until Paseo renders queued attachments. The plugin does not add fake text to the prompt to work around this, because that would change the message sent to the agent.

### Web composer integration

Paseo does not currently expose a public API for adding an arbitrary attachment to the active composer from a selection event. The plugin therefore uses a small web-only bridge to Paseo's existing composer attachment setter. A Paseo UI change can require an update to this bridge.

### Selecting text

Paseo does not expose assistant-message identity to plugins. The action is available for selectable conversation text outside the composer, so use it on assistant replies. If the selected text is no longer present after a conversation update, the plugin reports that it cannot find the citation.

### Fallback mode

If the composer bridge is not available, the plugin copies the formatted citation so you can paste it into the composer. If no composer can be found, it also uses this fallback.

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

The test suite covers citation formatting, multiple citations, delimiter-like quote and comment content, size limits, how new citations merge with existing attachments, and the committed React fiber lookup against React DOM.

## Project layout

```text
.
├── client/
│   ├── citation-attachment.ts        Citation composer attachment model and merge
│   ├── citation-attachment.test.mjs  Attachment merge tests
│   ├── citation-format.ts            Citation model and text compatibility format
│   ├── citation-format.test.mjs      Formatting tests
│   ├── react-fiber.ts                Committed React fiber lookup for the composer bridge
│   ├── react-fiber.test.mjs          Fiber lookup tests against React DOM
│   └── web.ts                        Web selection, composer bridge, and overlay UI
├── test/resolve-ts.mjs               Node import hook for extensionless TypeScript imports
├── index.client.tsx                  Paseo client entry point
├── paseo-plugin.json                 Paseo plugin manifest
├── package.json                      Development scripts and SDK versions
└── tsconfig.json                     Strict, DOM-free TypeScript configuration
```

Only `client/web.ts` touches browser APIs. The rest of the plugin remains compatible with Paseo's client bundle rules.

## Contributing

Before opening a change, run:

```sh
npm run typecheck
npm test
```

Keep changes web-only when they depend on `window` or `document`, preserve the native Paseo attachment renderer, and test each new behavior at the lowest level that can detect a regression.
