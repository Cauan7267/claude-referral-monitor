export function health(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  return response.status(200).json({ service: 'Claude Pass Radar', status: 'ready' });
}
export default health;
