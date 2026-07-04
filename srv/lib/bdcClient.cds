using {fanrio.auth as db} from '../../db/schema';


entity BdcSettings as projection on db.BdcSettings;


action runBdcTaskChain(url: String,
                       tokenUrl: String,
                       clientId: String,
                       clientSecret: String,
                       space: String,
                       taskChainId: String)         returns LargeString;

action fetchBdcTaskChainLog(url: String,
                            tokenUrl: String,
                            clientId: String,
                            clientSecret: String,
                            space: String,
                            logId: String)          returns LargeString;


action fetchRawBdcSpaces(url: String,
                         tokenUrl: String,
                         clientId: String,
                         clientSecret: String)      returns LargeString;

action fetchRawBdcAssets(url: String,
                         tokenUrl: String,
                         clientId: String,
                         clientSecret: String)      returns LargeString;

action fetchRawBdcRelationalValues(url: String,
                                   tokenUrl: String,
                                   clientId: String,
                                   clientSecret: String,
                                   space: String,
                                   asset: String)   returns LargeString;

action fetchRawBdcAssetColumns(url: String,
                               tokenUrl: String,
                               clientId: String,
                               clientSecret: String,
                               space: String,
                               asset: String)       returns LargeString;

action triggerReplication()                         returns {
    success : Boolean;
    message : String;
};

action checkReplicationStatuses()                   returns {
    success : Boolean;
    message : String;
};

action testBdcConnection(settingId: UUID)           returns {
    success : Boolean;
    message : String;
};

action fetchBdcSpaces(url: String,
                      tokenUrl: String,
                      clientId: String,
                      clientSecret: String)         returns array of String;

action fetchBdcAssets(url: String,
                      tokenUrl: String,
                      clientId: String,
                      clientSecret: String,
                      space: String)                returns array of String;

action fetchBdcRelationalValues(url: String,
                                tokenUrl: String,
                                clientId: String,
                                clientSecret: String,
                                space: String,
                                asset: String,
                                assetText: String,
                                idColumns: String,
                                textColumn: String) returns array of {
    id   : String;
    text : String;
};

action fetchBdcAssetColumns(url: String,
                            tokenUrl: String,
                            clientId: String,
                            clientSecret: String,
                            space: String,
                            asset: String)          returns array of String;


action fetchBdcAssociations(url: String,
                            tokenUrl: String,
                            clientId: String,
                            clientSecret: String,
                            space: String,
                            asset: String)          returns LargeString;
