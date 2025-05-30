export async function GET() {
  return Response.json({
    message: "HELLLOOOOOOOO",
    timestamp: new Date().toISOString(),
  });
}
