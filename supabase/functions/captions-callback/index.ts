Deno.serve(() => Response.json(
  { error: 'The legacy caption callback is retired.' },
  { status: 410 },
));
