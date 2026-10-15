# Chat layout manual checklist

Test direct and group threads, community chat, and post-detail comments on a real
Android device. Repeat in light and dark themes, portrait, with gesture and
three-button navigation, at the default font scale and 200% font scale.

## Three-zone layout

- [ ] Header remains fixed at the top and contains back, avatar, name, status
      (Online, Typing, or blank), voice-call, and video-call actions where valid.
- [ ] The message area is the only scrolling zone; the composer stays below it
      and is never positioned over messages.
- [ ] Safe-area/status and navigation-bar insets do not overlap the header or
      composer.
- [ ] Community chat keeps the community page header and tabs fixed while the
      chat list and composer fit in the remaining area.
- [ ] Post-detail comments show video/post information above the comments. Focus
      the comment field: the video/post context collapses and returns after the
      keyboard closes.
- [ ] A 640 dp-tall phone keeps the header and send/save controls visible with a
      tall suggestion-strip keyboard and with the emoji keyboard open.
- [ ] The keyboard and composer meet with no gap or overlap; closing the keyboard
      animates the layout back.
- [ ] Focus the composer and send several messages without closing the keyboard;
      the newest message remains visible.
- [ ] Tap empty list space to dismiss the keyboard. Tapping a bubble, link, or
      reaction does not dismiss it.
- [ ] Android Back closes the keyboard first, then an open menu/sheet, then exits
      the thread.

## Messages, scrolling, and composer

- [ ] Test a conversation with zero, one, and 500 messages.
- [ ] Empty state is centered in the list area; loading skeletons and offline
      banner do not move the composer.
- [ ] Scroll up to load older messages using keyset pagination; existing items
      remain stable and the list does not jump.
- [ ] Scroll more than about 200 dp from the newest message; the scroll-to-bottom
      control appears, shows the new-message count, and returns smoothly to latest.
- [ ] Receive a message at the bottom: remain at the bottom. Receive one while
      scrolled up: do not jump and increment the count.
- [ ] Date separators, grouped bubbles, Seen, typing indicator, failed-message
      retry, reactions, and reply preview still work.
- [ ] Long text wraps without horizontal overflow. A wide image/video reserves
      its stored dimensions before loading and does not shift the list.
- [ ] Composer grows from one line to at most five lines (about 120 dp), then
      scrolls internally; attach, send, and record controls are at least 44 dp.
- [ ] Reply preview increases composer height. Recording shows its status row
      without replacing or moving the message list independently.
- [ ] Send switches to the send action when text is present; empty composer shows
      the existing voice-record action. Photo, video, and camera/attachment flows
      remain usable.
