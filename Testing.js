// TESTING

// YAKUMAN

// KOKUSHI MUSOU
wss({
  type: 'action',
  action: {
    type: 'debug_set_hand',
    tiles: [
      {s:'m', v:1}, {s:'m', v:9},
      {s:'p', v:1}, {s:'p', v:9},
      {s:'s', v:1}, {s:'s', v:9},
      {s:'z', v:1}, {s:'z', v:2}, {s:'z', v:3}, {s:'z', v:4},
      {s:'z', v:5}, {s:'z', v:6}, {s:'z', v:7}
    ],
    drawTile: {s:'m', v:1}
  }
});

