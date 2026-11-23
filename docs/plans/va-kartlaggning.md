# Kartläggning av vatten och avlopp, 23 november 2026

## Underlag

- [SCB TAB628, befolkning 31 december 2025](https://statistikdatabasen.scb.se/api/v2/tables/TAB628/data?lang=sv&outputFormat=json-stat2&valuecodes%5BRegion%5D=*&valuecodes%5BKon%5D=1%2B2&valuecodes%5BContentsCode%5D=BE0101U2&valuecodes%5BTid%5D=top%281%29) ger rikstalet **10 605 529**. De 52 kommunerna i uppdraget har **6 538 718 invånare (61,65 %)**. Folkmängden är ett mått på räckvidd. En andel av anslutna VA-kunder och antalet adresser med SMS-precision går inte att räkna fram ur den.
- Lokal VA-organisation avser verksamheten närmast kunden även när ett gemensamt bolag driver anläggningen. [Svenskt Vattens medlemslista](https://www.svensktvatten.se/natverk-och-medlemskap/medlem-och-partner/medlemslista/) och verksamheternas egna sidor är organisationsunderlag. [Norrvatten](https://www.norrvatten.se/om-norrvatten/medlemskommuner/) är grossist. Medlemskommunernas lokala nät och aviseringar bedöms var för sig. På motsvarande sätt redovisas [Sydvatten](https://sydvatten.se/om-sydvatten/delagarkommuner/) genom de lokala organisationerna. Ekerös kommunala VA överläts till Roslagsvatten; den sökträff där Norrtälje Vatten och Avfall beskriver en ort kallad Äkerö gäller en annan plats.
- Delade huvudmän har grupperats med de kommuner deras publika flöde avser. Gruppbefolkningen omfattar även mindre medlemskommuner. För VA SYD [fem VA-kommuner](https://eslov.se/bygga-bo-miljo/vatten-och-avlopp/), [NSVA åtta](https://helsingborg.se/bo-bygga-och-miljo/vatten-och-avlopp/), [Gästrike Vatten fem](https://www.gastrikevatten.se/varakommuner.68.html), [Vakin tre](https://www.vakin.se/omvakin/ombolaget.4.c0155ee182c49336f0194d.html) och [Roslagsvatten fem](https://roslagsvatten.se/content/vara-styrelser). Västvatten redovisas för Uddevalla, Färgelanda, Munkedal och Sotenäs. MittSverige Vatten & Avfall för Sundsvall, Timrå och Nordanstig. VA SYD:s samarbete om enskilda delar av VA i andra kommuner räknas inte in.
- GET av de publika sidorna och publicerade AJAX/JSON/RSS-anrop provades lokalt och via curl från f-radar i Frankrike den 23 november. Tabellen anger om sidans eller den angivna datakällans HTTP-svar gick att hämta. En lyckad sidvisning visar endast att sidan går att nå. För valda källor kontrollerades även datastrukturen. Timeout från Frankrike kan bero på geografisk spärr, nätväg eller annat.
- [ServiceAlert](https://servicealert.se/) använder samma POST till `/api/WebMessage/GetDriftstatusWebMessagesMapModel` med `{ "customerIds": "<publikt kund-id>" }` hos `se.sms-service.dk` och `servicealert.se`. Kund-id:n är publicerade i kartans eller SMS-prenumerationens iframe. En SMS-prenumeration innebär inte att en webbprofil finns. Inga prenumerationer skapades.
- För [Krisinformation](https://www.krisinformation.se/om-krisinformation.se/oppen-data/) hämtades det befintliga JSON-flödet från båda platser. Det innehöll ingen aktiv kokningsnyhet vid provet. Flödet kan publicera kokningsnyheter men täcker inte alla lokala rekommendationer och har normalt kommun eller län som avgränsning. Se [tidigare källprov](../sources/utility-outages-2026-11-19/README.md).

## Källor per organisation

| Invånare | Kommuner | VA-organisation | Källa | Plattform | Precision | Svar från podden | Bedömning |
|---:|---|---|---|---|---|---|---|
| 1 113 925 | Stockholm, Huddinge | Stockholm Vatten och Avfall | [Källa](https://www.stockholmvattenochavfall.se/driftinfo/) | SVOA · paginerad JSON | Polygon | Ja | Befintlig. Vatten och avlopp filtreras från avfall och projekt. |
| 613 278 | Göteborg | Göteborgs Stad, Kretslopp och vatten | [Källa](https://goteborg.se/wps/portal/start/bygga-bo-och-leva-hallbart/vatten-och-avlopp/vattenavstangningar-och-andra-storningar/vattenavstangningar) | ServiceAlert JSON | Adresspunkter | Ja | Användbar. 12 poster med adresspunkter. Den äldre kartlänken ger 404. |
| 580 504 | Malmö, Lund, Burlöv, Eslöv, Lomma | VA SYD | [Källa](https://www.vasyd.se/driftinformation) | Sitecore · kategoriserad HTML | Gata/område i text | Nej | Otillgänglig från podden. Sidan fungerar lokalt, men upprepade poddprov tog timeout. |
| 280 818 | Helsingborg, Landskrona, Bjuv, Båstad, Perstorp, Svalöv, Åstorp, Örkelljunga | Nordvästra Skånes Vatten och Avlopp (NSVA) | [Källa](https://nsva.se/driftinformation/) | WordPress · inbäddat kart-JSON | Kartpunkt; adress/gata i separat text | Ja | Användbar på punktnivå. Händelsetyper är strukturerade. 57 markörer, inklusive ledningsprojekt som filtreras. |
| 249 726 | Uppsala | Uppsala Vatten och Avfall | [Källa](https://www.uppsalavatten.se/funktioner/aktuella-driftstorningar) | Sitevision · RSS och HTML | Gata/område i text | Ja | Osäker. Det länkade RSS-flödet innehöll bolagets nyheter, inte den aktuella listan med vattenavbrott. Driftlistan har fritext. |
| 168 714 | Linköping | Tekniska verken | [Källa](https://avbrott.tekniskaverken.se/api/service-information/outage/list/?utility=water&brand=tekniskaverken) | JSON och GeoJSON | Polygon | Ja | Befintlig. Listan och tillhörande form verifierade. |
| 161 240 | Västerås | Mälarenergi Vatten | [Källa](https://www.malarenergi.se/avbrott/) | ServiceAlert JSON | Adresspunkter | Ja | Användbar. Separat från kartan för el och värme. VA Distribution innehöll en post. |
| 160 687 | Örebro | Örebro kommun | [Källa](https://orebro.se/bygga-bo--trafik/vatten--avlopp/pagaende-och-planerade-vatten---avloppsarbeten.html) | Sitevision · RSS och kartlänk | Gata/område i text | Ja | Osäker. Allmänt drift-RSS och karta för VA-arbeten. Ingen verifierad koppling till samtliga aktuella VA-avbrott. |
| 150 715 | Gävle, Hofors, Ockelbo, Älvkarleby, Östhammar | Gästrike Vatten | [Källa](https://www.gastrikevatten.se/vattenavlopp/driftstorningar.202.html) | ServiceAlert JSON | Ritade polygoner | Ja | Användbar. Fyra VA-poster med ritade ytor. |
| 148 152 | Jönköping | Jönköpings kommun | [Källa](https://www.jonkoping.se/bygga-bo--miljo/vatten-och-avlopp/kommunalt-vatten-och-avlopp/planerade-och-akuta-vattenavstangningar) | Sitevision · webbsida och SMS | Text vid större avstängningar | Ja | Osäker. Sidan beskriver SMS och större avstängningar. Inget läsbart kartlager bekräftat. |
| 147 735 | Österåker, Vallentuna, Ekerö, Vaxholm, Knivsta | Roslagsvatten | [Källa](https://roslagsvatten.se/driftinformation) | Drupal · HTML och liststatus | Gata/område i text | Ja | Osäker. Aktiva artikel-id:n finns, men inget verifierat kartlager eller stabilt geografiskt kontrakt. |
| 147 599 | Umeå, Nordmaling, Vindeln | Vakin | [Källa](https://www.vakin.se/omvakin/alladriftstorningar.4.c0155ee182c49336f01b6a.html) | Sitevision · JSON /api/outages | Kommunfält och fritext | Ja | Osäker. Planerade och åtgärdade poster har strukturerad status. Kommunfältet anger sortering och avgränsar inte adresserna som berörs. |
| 144 904 | Norrköping | Nodra | [Källa](https://nodra.se/driftinformation) | App och SMS | Ingen publik driftlista på sidan | Ja (informationssidan) | Ingen läsbar källa i dag. Nodra hänvisar till SMS och app för löpande driftinformation. |
| 132 880 | Halmstad, Laholm | Laholmsbuktens VA | [Källa](https://www.lbva.se/driftinformation) | Sitevision · RSS /rss/driftmeddelanden | Ingen aktuell post observerad | Ja | Osäker. RSS svarade med giltig tom kanal. Geografi och innehåll kunde inte verifieras. |
| 125 711 | Sundsvall, Timrå, Nordanstig | MittSverige Vatten & Avfall | [Källa](https://msva.se/driftstorningar) | ServiceAlert JSON | Ritade polygoner | Ja | Användbar. Fyra VA-poster med ritade ytor i det offentliga webbsvaret. |
| 116 781 | Varberg, Falkenberg | Vatten & Miljö i Väst (Vivab) | [Källa](https://vivab.se/driftstorning) | Joomla · HTML | Gata/område i text | Ja | Osäker. Nyheter, ledningsarbeten och avbrott delar lista. Inget stabilt avbrottsfält bekräftat. |
| 115 238 | Borås | Borås Energi och Miljö | [Källa](https://borasem.se/webb/foretag/kundcenter/driftstorning.106.3463dd8816cce3bd1d889d9c.html) | Sitevision · HTML | Gata/område i text | Ja | Osäker. Separata notiser, men blandat underhåll och avbrott utan bekräftad maskinläsbar avgränsning. |
| 113 730 | Nacka | Nacka vatten och avfall | [Källa](https://www.nacka.se/nackavattenavfall/driftinformation/) | HTML · driftlänkar och SMS | Gata eller område i text | Ja | Osäker. Inget verifierat maskinläsbart flöde bakom länkarna. |
| 106 789 | Eskilstuna | Eskilstuna Energi och Miljö, drift genom ESEM | [Källa](https://www.eem.se/privat/kundservice/driftinformation/) | ServiceAlert JSON | Ritad polygon och adresspunkter | Ja | Befintligt stöd. Aktuellt prov har båda formaten. Strängnäs har egen VA-huvudman och ingår inte i detta kund-id. |
| 102 772 | Södertälje | Telge Nät | [Källa](https://www.telge.se/kundservice/driftstatus/) | Blazor-karta | Ej verifierad | Ja (sidan) | Osäker. Ingen verifierad publik VA-data från kartan. |
| 101 408 | Haninge | Haninge kommun | [Källa](https://www.haninge.se/bygga-trafik-och-miljo/vatten-och-avlopp/driftinformationva/) | HTML och ServiceAlert SMS | Gata/område i text | Ja | Osäker. Kund-id:t för SMS gav HTTP 200 med noll webbprofiler. Kommunens webbnotiser innehåller även arbeten. |
| 99 007 | Karlstad | Karlstads kommun | [Källa](https://karlstad.se/storningar) | Sitevision · HTML | Gata/område i text | Ja | Osäker. Kommunens VA-meddelanden och trafikmeddelanden samsas. Karlstads Elnäts ServiceAlert är en annan källa. |
| 98 940 | Växjö | Växjö kommun | [Källa](https://www.vaxjo.se/sidor/bygga-och-bo/vatten-och-avlopp/aktuella-driftstorningar-for-vatten-och-avlopp.html) | ServiceAlert JSON | Områdesformat i kartplattformen | Ja | Användbar. Kommunens VA-karta publicerar en VA-profil. Tom vid provet, så meddelandeform och precision här återstår att verifiera. |
| 96 750 | Botkyrka | Botkyrka kommun | [Källa](https://www.botkyrka.se/boende-och-narmiljo/vatten-och-avlopp/driftinformation-och-pagaende-arbeten/storningsinformation) | Sitevision · HTML/kartlänk, Everbridge SMS | Gata/område i text | Ja | Osäker. Inget maskinläsbart VA-lager bekräftat. |
| 90 180 | Järfälla | Järfälla kommun | [Källa](https://www.jarfalla.se/specialsidor/storningsinfo.4.421f0b841837df3ef035887b.html) | Sitevision · HTML | Gata/område i text | Ja | Osäker. Gemensam kommunal störningssida. Inget särskilt VA-flöde bekräftat. |
| 86 435 | Solna | Solna Vatten | [Källa](https://www.solna.se/bygga-bo--miljo/vatten-och-avlopp/solna-vatten/driftinformation-storningar-och-felanmalan) | Sitevision · HTML med kartpunkter | Kartpunkt/gator i text | Ja | Osäker. Publicerade punkter för långvariga arbeten; inget verifierat fullständigt flöde för akuta avbrott. |
| 86 332 | Kungsbacka | Kungsbacka kommun | [Källa](https://kungsbacka.se/nyheter/alla-driftsmeddelanden) | Sitevision · HTML | Gata/område i text | Ja | Osäker. Driftsmeddelanden blandar VA och trafik. |
| 85 908 | Kristianstad | Kristianstads kommun | [Källa](https://www.kristianstad.se/servicemeddelanden.5801.html) | Sitevision · HTML | Ort/område i text | Ja | Osäker. Gemensamma servicemeddelanden. Inget särskilt VA-flöde verifierat. |
| 82 340 | Uddevalla, Färgelanda, Munkedal, Sotenäs | Västvatten | [Källa](https://vastvatten.se/driftstorningar.html) | Sitevision · HTML och Everbridge SMS | Gata/område i text | Ja | Osäker. Aktuella avstängningar finns, men också trafik och andra projekt. Inga verifierade strukturerade avbrottstider eller kartområden. |
| 80 304 | Luleå | Luleå Miljöresurs (Lumire) | [Källa](https://lumire.se/driftinformation/) | ServiceAlert JSON | Adresspunkter | Ja | Användbar. Två VA-poster med många adresspunkter; avfall separat. |
| 78 514 | Täby | Täby kommun | [Källa](https://www.taby.se/bygga-bo-och-miljo/vatten-och-avlopp-va/va-drift-och-storningar) | HTML och ServiceAlert SMS | Gata/område i text | Ja | Osäker. Inga webbprofiler i ServiceAlert-svaret. Kommunens notiser finns separat. |
| 78 033 | Sollentuna | Sollentuna Energi & Miljö (SEOM) | [Källa](https://www.seom.se/driftstatus/vatten/missfargat-vatten-driftavbrott/) | HTML och app | Gata/område i text | Ja | Osäker. Publika VA-sidor och appbeskrivning. Inget verifierat separat maskinläsbart lager. |
| 75 405 | Skellefteå | Skellefteå kommun | [Källa](https://skelleftea.se/driftinfo) | Sitevision · HTML och Everbridge SMS | Gata/område i text | Ja | Osäker. Aktuell vattenläcka publicerad i blandad störningslista. Skellefteå Krafts elflöde gäller el. |
| 73 068 | Kalmar | Kalmar Vatten | [Källa](https://kalmarvatten.se/arkiv/pagaende-arbeten-och-driftstorningar.html) | Sitevision · HTML | Gata/område i text | Ja | Osäker. Avstängningar och projekt delar lista. Ingen verifierad strukturerad geografisk avgränsning. |
| 72 128 | Mölndal | Mölndals stad | [Källa](https://www.molndal.se/bygga-bo-och-miljo/vatten-och-avlopp/vattenavstangningar-och-avbrott) | ServiceAlert JSON | Ritade polygoner | Ja | Användbar. 17 VA-poster i kommunens eget kund-id, skilt från Mölndal Energi Nät. |
| 66 832 | Norrtälje | Norrtälje Vatten och Avfall | [Källa](https://www.nvaa.se/driftinformation) | WordPress · HTML | Gata/område i text | Ja | Osäker. Artiklar för både avfall och VA. Inget användbart kart-API bekräftat. |
| 66 021 | Karlskrona | Karlskrona kommun | [Källa](https://www.karlskrona.se/Bo-och-bygga/vatten-och-avlopp/information-via-sms-om-driftstorningar-som-ror-vatten-och-avlopp/) | Webbsida för SMS | Ej verifierad | Nej | Otillgänglig i provet. Informationssidan gav 403 på båda platserna. |
| 64 963 | Östersund | Östersunds kommun, Avfall VA | [Källa](https://www.ostersund.se/drift) | Sitevision · RSS och HTML | Gata/område i text | Ja | Osäker. Länkat RSS för servicemeddelanden är blandat. Ingen verifierad matchbar geografisk avgränsning. |
| 60 852 | Gotland | Region Gotland | [Källa](https://gotland.se/arkiv/drift--och-servicemeddelanden) | Sitevision · HTML och SMS | Gata/område i text | Ja | Osäker. Kommunal listning är blandad. Inget särskilt VA-flöde bekräftat. |
| 59 974 | Falun | Falu Energi & Vatten | [Källa](https://fev.se/driftstorningar) | Sitevision · RSS/HTML | Gata/område i text | Ja | Osäker. RSS blandar vatten, el och kundsystem. Kartlänken till Digpro gäller el. |
| 59 265 | Trollhättan | Trollhättan Energi | [Källa](https://www.trollhattanenergi.se/driftinformation/) | WordPress · HTML | Gata/område i text | Ja | Osäker. Visar en lista med detaljer; inget verifierat VA-API eller geografisk struktur. |
| 58 310 | Nyköping | Nyköpings kommun, Nyköping Vatten | [Källa](https://www.nykoping.se/arkiv/driftstorningar) | HTML · driftarkiv | Gata/område i text | Ja | Osäker. Allmänt driftarkiv med blandade meddelanden. |
| 58 272 | Skövde | Skövde kommun | [Källa](https://www.skovde.se/kommun-och-politik/kontakt-med-skovde-kommun/sms-vid-driftstorningar) | ServiceAlert SMS och webbsida | Ingen VA-webbprofil verifierad | Ja | Osäker. ServiceAlert gav en tom profil för Sektor Service. VA-täckning går inte att fastställa från den. |
| 57 000 | Sundbyberg | Sundbyberg Avfall och Vatten | [Källa](https://www.savab.se/sms-vid-driftstorningar/) | WordPress · SMS-sida och nyheter | Område i text | Ja | Osäker. Inget särskilt, maskinläsbart driftflöde bekräftat. |
| 55 338 | Örnsköldsvik | Miljö och Vatten i Örnsköldsvik (Miva) | [Källa](https://miva.se/kundservice/driftinformation) | ServiceAlert JSON | Punkt med publicerad radie | Ja | Användbar. Två VA-poster med radie. Lägre befolkning än de valda nya källorna. |
| 53 365 | Sigtuna | Sigtuna Vatten & Renhållning | [Källa](https://sigtunavatten.se/driftinformation/) | ServiceAlert JSON | Polygon och kartpunkt | Ja | Osäker. En polygon och en punkt utan radie av typen ByMap. Publikt flöde, men ofullständig matchning med verifierad profil. |
| 51 915 | Hässleholm | Hässleholm Miljö | [Källa](https://hassleholmmiljo.se/kundservice/driftinformation) | Sitevision · HTML och ServiceAlert SMS | Gata/område i text | Ja | Osäker. Kund-id för prenumeration saknade publika webbprofiler. |
| 51 354 | Borlänge | Borlänge Energi | [Källa](https://www.borlange-energi.se/driftinformation) | Sitevision · HTML | Gata/område i text | Ja | Osäker. Blandad aviseringslista. Digpro-länken gäller el. |
| 50 496 | Kungälv | Kungälvs kommun | [Källa](https://www.kungalv.se/Bygga--bo--miljo/vatten-och-avlopp/avbrott-och-storningar/) | HTML och ServiceAlert SMS | Gata/område i text | Ja | Osäker. Kund-id för prenumeration saknade webbprofiler. Kokningsinformation finns på separat kommunal sida. |
| 50 495 | Upplands Väsby | Upplands Väsby kommun | [Källa](https://www.upplandsvasby.se/bygga-bo-och-miljo/vatten-och-avlopp/sms-tjanst-for-driftmeddelanden) | Webbsida för ServiceAlert SMS | Ingen VA-webbprofil verifierad | Ja (informationssidan) | Ingen läsbar källa i dag. Det publika svaret har noll webbprofiler. Kommunen hänvisar till SMS. |
| 48 804 | Enköping | Enköpings kommun | [Källa](https://enkoping.se/bygga-bo-och-leva-hallbart/kommunalt-vatten-och-avlopp/vattenavstangningar.html) | Sitevision · HTML och ServiceAlert SMS | Gata/område i text | Ja | Osäker. SMS-kund-id saknar webbprofiler, separat sida publicerar kommunens text. |
| 24 954 | Ulricehamn | Ulricehamns Energi | [Källa](https://se.sms-service.dk/api/WebMessage/GetDriftstatusWebMessagesMapModel) | ServiceAlert JSON | Ritad polygon, någon notis utan geografi | Ja | Befintligt kodstöd. Prov delvis matchbart; ingår inte i baslinjens särskilda aktiveringslista. |
| 24 163 | Söderhamn | Söderhamn Nära | [Källa](https://servicealert.se/api/WebMessage/GetDriftstatusWebMessagesMapModel) | ServiceAlert JSON | Område när publicerat | Ja | Befintlig. VA-profil tillgänglig, tom i provet. |
| 18 377 | Ljusdal | Ljusdal Vatten (Ljusdal Energi) | [Källa](https://servicealert.se/api/WebMessage/GetDriftstatusWebMessagesMapModel) | ServiceAlert JSON | Punkt med publicerad radie | Ja | Befintlig. En VA-post med publicerad radie. |
| 11 962 | Oxelösund | Oxelö Energi | [Källa](https://se.sms-service.dk/api/WebMessage/GetDriftstatusWebMessagesMapModel) | ServiceAlert JSON | Område när publicerat | Ja | Befintlig. VA-profil tillgänglig, tom i provet. |
| 8 807 | Emmaboda | Emmaboda Energi | [Källa](https://se.sms-service.dk/api/WebMessage/GetDriftstatusWebMessagesMapModel) | ServiceAlert JSON | Område när publicerat | Ja | Befintlig. VA-profil tillgänglig, tom i provet. |

## Kommuner efter folkmängd

| SCB-kod | Kommun | Invånare | Lokal VA-organisation |
|---|---|---:|---|
| 0180 | Stockholm | 999 239 | Stockholm Vatten och Avfall |
| 1480 | Göteborg | 613 278 | Göteborgs Stad, Kretslopp och vatten |
| 1280 | Malmö | 367 924 | VA SYD |
| 0380 | Uppsala | 249 726 | Uppsala Vatten och Avfall |
| 0580 | Linköping | 168 714 | Tekniska verken |
| 1980 | Västerås | 161 240 | Mälarenergi Vatten |
| 1880 | Örebro | 160 687 | Örebro kommun |
| 1283 | Helsingborg | 152 776 | Nordvästra Skånes Vatten och Avlopp (NSVA) |
| 0680 | Jönköping | 148 152 | Jönköpings kommun |
| 0581 | Norrköping | 144 904 | Nodra |
| 2480 | Umeå | 135 273 | Vakin |
| 1281 | Lund | 132 333 | VA SYD |
| 1490 | Borås | 115 238 | Borås Energi och Miljö |
| 0126 | Huddinge | 114 686 | Stockholm Vatten och Avfall |
| 0182 | Nacka | 113 730 | Nacka vatten och avfall |
| 0484 | Eskilstuna | 106 789 | Eskilstuna Energi och Miljö, drift genom ESEM |
| 1380 | Halmstad | 106 315 | Laholmsbuktens VA |
| 2180 | Gävle | 104 108 | Gästrike Vatten |
| 0181 | Södertälje | 102 772 | Telge Nät |
| 0136 | Haninge | 101 408 | Haninge kommun |
| 1780 | Karlstad | 99 007 | Karlstads kommun |
| 2281 | Sundsvall | 98 962 | MittSverige Vatten & Avfall |
| 0780 | Växjö | 98 940 | Växjö kommun |
| 0127 | Botkyrka | 96 750 | Botkyrka kommun |
| 0123 | Järfälla | 90 180 | Järfälla kommun |
| 0184 | Solna | 86 435 | Solna Vatten |
| 1384 | Kungsbacka | 86 332 | Kungsbacka kommun |
| 1290 | Kristianstad | 85 908 | Kristianstads kommun |
| 2580 | Luleå | 80 304 | Luleå Miljöresurs (Lumire) |
| 0160 | Täby | 78 514 | Täby kommun |
| 0163 | Sollentuna | 78 033 | Sollentuna Energi & Miljö (SEOM) |
| 2482 | Skellefteå | 75 405 | Skellefteå kommun |
| 0880 | Kalmar | 73 068 | Kalmar Vatten |
| 1481 | Mölndal | 72 128 | Mölndals stad |
| 1383 | Varberg | 69 460 | Vatten & Miljö i Väst (Vivab) |
| 0188 | Norrtälje | 66 832 | Norrtälje Vatten och Avfall |
| 1080 | Karlskrona | 66 021 | Karlskrona kommun |
| 2380 | Östersund | 64 963 | Östersunds kommun, Avfall VA |
| 0980 | Gotland | 60 852 | Region Gotland |
| 2080 | Falun | 59 974 | Falu Energi & Vatten |
| 1488 | Trollhättan | 59 265 | Trollhättan Energi |
| 0480 | Nyköping | 58 310 | Nyköpings kommun, Nyköping Vatten |
| 1496 | Skövde | 58 272 | Skövde kommun |
| 0183 | Sundbyberg | 57 000 | Sundbyberg Avfall och Vatten |
| 1485 | Uddevalla | 56 744 | Västvatten |
| 2284 | Örnsköldsvik | 55 338 | Miljö och Vatten i Örnsköldsvik (Miva) |
| 0191 | Sigtuna | 53 365 | Sigtuna Vatten & Renhållning |
| 1293 | Hässleholm | 51 915 | Hässleholm Miljö |
| 2081 | Borlänge | 51 354 | Borlänge Energi |
| 1482 | Kungälv | 50 496 | Kungälvs kommun |
| 0114 | Upplands Väsby | 50 495 | Upplands Väsby kommun |
| 0381 | Enköping | 48 804 | Enköpings kommun |

## Befolkning som kan nås

- Befintlig konfigurerad baslinje omfattar Stockholm, Huddinge, Linköping, Söderhamn, Oxelösund, Emmaboda och Ljusdal. Det motsvarar **1 345 948 av 10 605 529 invånare (12,69 %)**. De sex hämtjobben hade färska svar vid en läsning av summerad källhälsa, inklusive SVOA med fyra avbrott, 18 lästa övriga poster och en överhoppad. Aktiveringslistan lästes från podden. De delade jobben för Eskilstuna och Ulricehamn var avstängda för vatten.
- Den tidigare kommunmappningen i täckningsrapporten omfattade Stockholm, Huddinge och Linköping, **12,09 %** av Sveriges befolkning. Den nya mappningen räknar också in kommunerna där befintliga ServiceAlert-flöden redan hämtas när deras VA-källa är aktiv och aktuell.
- Åtta prioriterade nya källor omfattar ytterligare **1 583 134 invånare (14,93 %)**. Tillsammans med baslinjen blir det **2 929 082 invånare (27,62 %)** när källorna är aktiverade och aktuella. Kartlagda läsbara källor utanför urvalet, som Miva, räknas inte in i det utfallet.
- Av tillskottet har **1 135 640 invånare (10,71 % av Sverige)** källor med publicerade punkter och **348 554 (3,29 %)** källor med observerade, ritade områden. Växjö omfattar ytterligare **98 940 (0,93 %)**. Utan Växjö når möjlig räckvidd **26,69 %**. Mivas publicerade radier omfattar en möjlig ytterligare **0,52 %** av rikets befolkning.
- Publik källdata finns i [fixtures](../../packages/integrations/test/fixtures/utility-outages/). ServiceAlert-svaren är beskurna och adresspunkterna i dem avrundade för att bevara formen utan att återge enskilda mottagaradresser. Vakin, RSS-proven och NSVA:s inbäddade kartdata är sparade i samma katalog. Den äldre SVOA-fixturen visar sidindelningen. Källfilerna innehåller publicerade meddelanden.

## Inkopplat i kod

| Operatörs-id | VA-organisation och omfattning | Läsbara poster i hela provsvaret |
|---|---|---:|
| `servicealert:goteborg` | Kretslopp och vatten, Göteborg | 12 |
| `nsva` | NSVA, Helsingborg, Landskrona, Bjuv, Båstad, Perstorp, Svalöv, Åstorp och Örkelljunga | 9 |
| `servicealert:malarenergi-va` | Mälarenergi Vatten, Västerås | 1 |
| `servicealert:gastrike-vatten` | Gästrike Vatten, Gävle, Hofors, Ockelbo, Älvkarleby och Östhammar | 4 |
| `servicealert:msva` | MittSverige Vatten & Avfall, Sundsvall, Timrå och Nordanstig | 4 |
| `servicealert:vaxjo-va` | Växjö kommun | 0, giltig tom VA-profil |
| `servicealert:lumire` | Lumire, Luleå | 2 |
| `servicealert:molndal-va` | Mölndals stad | 17 |

Samtliga åtta datakällor gav HTTP 200 lokalt och från podden. I de fullständiga lokala provsvaren överhoppades inga poster på grund av formatfel. NSVA:s svar innehöll också 48 avslutade driftstörningar och arbetsmarkörer som filtrerades. Lumires avfallsprofil filtrerades också.

De nya källorna är avstängda som standard. Vid aktivering läggs följande till i befintlig `UTILITY_OUTAGE_WATER_OPERATORS`. Befintliga id:n ska behållas.

```text
servicealert:goteborg,nsva,servicealert:malarenergi-va,servicealert:gastrike-vatten,servicealert:msva,servicealert:vaxjo-va,servicealert:lumire,servicealert:molndal-va
```

`SOURCE_UTILITY_WATER_ENABLED` och `SOURCE_UTILITY_OUTAGES_ENABLED` måste vara aktiva. Om `UTILITY_OUTAGE_OPERATORS` är en uttrycklig tillåtelselista behöver samma nya id:n finnas där. Den ordinarie deployhjälparen har en fast VA-lista. En framtida release som använder den behöver behålla de nya id:n i sin konfiguration.

- Punkter matchas bara som information nära fastigheten. Varken adressprickar eller NSVA:s markörer bildar ett avbrottsområde. ServiceAlerts ritade ytor används med områdesprecision. Ingen av de åtta nya källorna kan utlösa SMS med den precision som har verifierats.
- NSVA skiljer kommande och pågående driftstörningar i kartans data. Inga start- eller sluttider läggs till där kartan saknar dem. ServiceAlert publicerar meddelandets publicerings- och utgångstid. Utgångstiden visas inte som en prognos för att vattnet kommer tillbaka.
- En uttrycklig kokningsrekommendation med publicerat område blir röd och kräver kvittering med befintliga regler. Punkter ensamma kan inte avgränsa rekommendationen. Ett sådant meddelande utan publicerat område markeras som överhoppat i källhälsan. Någon aktiv kokningsrekommendation observerades inte vid provet.
- Täckningsrapporten skiljer på aktuell bevakning, avstängd källa, otillgänglig källa, vattenbolag utan läsbar källa och ej bedömd kommun. Norrköping och Upplands Väsby har här klassats utan läsbar källa. Övriga osäkra kommuner förblir ej bedömda.

## Verifiering

Vitest gav 803 godkända och 6 överhoppade tester utan lokal testdatabas. ESLint, projektets typkontroll och separat typkontroll av integrationstesterna gick igenom. PostgreSQL/PostGIS-sviten på `fastighetsradar_test` gav 53 av 53 godkända tester, inklusive områdes- och punktmatchning mot fastigheter. Kodändringarna ligger ocommittade. Aktivering, migrering och driftsättning behövdes inte för provet.
