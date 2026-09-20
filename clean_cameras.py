import sqlite3

conn = sqlite3.connect('ibvap_surveillance.db')
c = conn.cursor()
c.execute("DELETE FROM cameras WHERE rtsp_url LIKE 'synthetic://%'")
print('Deleted synthetic rows:', c.rowcount)
c.execute("SELECT id, code, name, rtsp_url, status FROM cameras")
print('Current cameras in DB:', c.fetchall())
conn.commit()
conn.close()
