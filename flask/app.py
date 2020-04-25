from flask import Flask, render_template, request
from flask import render_template
import requests

app = Flask(__name__)


@app.route('/')
def index():
    return render_template('index.html')

if __name__ == "__main__":
    app.run()








#country = 'Greece'
   # url = 'https://api.covid19api.com/summary'
   # r = requests.get(url.format(country)).json()
#https://api.covid19api.com/dayone/country/greece/status/confirmed
#https://api.covid19api.com/summary